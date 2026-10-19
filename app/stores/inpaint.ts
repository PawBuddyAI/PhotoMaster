import * as Comlink from 'comlink'
import { defineStore } from 'pinia'
import { markRaw, ref } from 'vue'
import { useImageWorker } from '~/composables/useImageWorker'
import { useProjectAssets } from '~/composables/useProjectAssets'
import { canvasToBlob, pixelsToCanvas } from '~/lib/image/canvas'
import { composeBase } from '~/lib/image/compose'
import { toOpenAIMask } from '~/lib/inpaint/composite'
import { buildEditRegion } from '~/lib/inpaint/regions'
import { type EditPlan, planEditRegion } from '~/lib/inpaint/sizing'
import { createOpenAIClient } from '~/lib/llm/client'
import { describeError, type FriendlyError } from '~/lib/llm/errors'
import { type ImageEditUsage, requestImageEdit } from '~/lib/llm/imageEdit'
import { buildEditPrompt } from '~/lib/llm/prompts'
import { rasterizeMask } from '~/lib/mask/rasterize'
import { maskBoundsPx, maskKey } from '~/lib/mask/spec'
import { putBlob } from '~/lib/storage/db'
import type { GenerativeLayer } from '~/lib/types'
import { useEditorStore } from './editor'
import { useSettingsStore } from './settings'

export interface InpaintCandidate {
  patch: Blob
  previewUrl: string
  colorCorrected: boolean
}

export type InpaintStage = 'preparing' | 'generating' | 'finalizing' | 'done' | 'error'

export interface InpaintJob {
  layerId: string
  stage: InpaintStage
  plan: EditPlan
  /** 发起时的区域快照，应用结果前校验区域未被修改 */
  maskSnapshot: string
  /** 每个候选最新的中间图 */
  partialUrls: string[]
  candidates: InpaintCandidate[]
  usage: ImageEditUsage | null
  error: FriendlyError | null
  startedAt: number
  controller: AbortController
}

/**
 * 生成式重绘任务：裁剪底图 → 生成编辑蒙版 → 调用 images/edits → Worker 中色彩匹配并生成补丁 → 候选待用户挑选。
 * 任务按图层管理，结果确认后才写入工程（可撤销）。
 */
export const useInpaintStore = defineStore('inpaint', () => {
  const jobs = ref<Record<string, InpaintJob>>({})

  function isRunning(layerId: string): boolean {
    const stage = jobs.value[layerId]?.stage
    return stage === 'preparing' || stage === 'generating' || stage === 'finalizing'
  }

  async function run(layerId: string): Promise<void> {
    if (isRunning(layerId)) {
      return
    }
    const editor = useEditorStore()
    const settings = useSettingsStore()
    const assets = useProjectAssets()
    const meta = editor.project
    const index = editor.layers.findIndex(l => l.id === layerId)
    const layer = editor.layers[index]
    if (!meta || !layer || layer.kind !== 'generative') {
      throw new Error('请先选择一个重绘图层')
    }
    if (!layer.prompt.trim()) {
      throw new Error('请先填写重绘指令')
    }
    const bounds = maskBoundsPx(layer.mask, meta.width, meta.height)
    if (!bounds) {
      throw new Error('重绘区域为空，请先框选或涂抹需要修改的区域')
    }

    discard(layerId)
    const plan = planEditRegion(bounds, meta.width, meta.height, {
      mode: settings.image.sizeMode,
      maxLongSide: settings.image.maxLongSide
    })
    const mask = JSON.parse(JSON.stringify(layer.mask)) as GenerativeLayer['mask']
    const job: InpaintJob = {
      layerId,
      stage: 'preparing',
      plan,
      maskSnapshot: maskKey(mask),
      partialUrls: [],
      candidates: [],
      usage: null,
      error: null,
      startedAt: Date.now(),
      controller: markRaw(new AbortController())
    }
    jobs.value[layerId] = job
    // 任务可能在等待期间被取消或丢弃，此时按取消处理
    const live = () => {
      const current = jobs.value[layerId]
      if (!current || current.startedAt !== job.startedAt) {
        throw new DOMException('任务已取消', 'AbortError')
      }
      return current
    }

    try {
      // 重绘以该图层之下的内容为底图（原图 + 下方已生成的补丁）
      const original = assets.requireOriginal()
      const patchesBelow = await assets.patchSources(editor.layers.slice(0, index))
      const { crop, outW, outH } = plan
      const image = await canvasToBlob(composeBase(original, patchesBelow, crop, outW, outH), 'image/png')
      const editRegion = buildEditRegion(rasterizeMask(mask, meta.width, meta.height, crop, outW, outH), outW, outH)
      const maskBlob = await canvasToBlob(pixelsToCanvas(toOpenAIMask(editRegion), outW, outH), 'image/png')

      live().stage = 'generating'
      const client = createOpenAIClient(settings.imageConnection)
      const outcome = await requestImageEdit(client, {
        model: settings.image.model,
        image,
        mask: maskBlob,
        prompt: buildEditPrompt(layer.prompt),
        size: `${outW}x${outH}`,
        quality: settings.image.quality,
        n: settings.image.n,
        stream: settings.image.stream,
        partialImages: settings.image.partialImages,
        signal: job.controller.signal
      }, {
        onPartial: (candidate, blob) => {
          const urls = live().partialUrls
          if (urls[candidate]) {
            URL.revokeObjectURL(urls[candidate])
          }
          urls[candidate] = URL.createObjectURL(blob)
        }
      })

      live().stage = 'finalizing'
      live().usage = outcome.usage
      const worker = useImageWorker()
      for (const generated of outcome.images) {
        const originalCrop = await createImageBitmap(composeBase(original, patchesBelow, crop, crop.w, crop.h))
        const result = await worker.finalizeCandidate(Comlink.transfer({
          generated,
          originalCrop,
          mask,
          imageW: meta.width,
          imageH: meta.height,
          crop
        }, [originalCrop]))
        live().candidates.push({
          patch: markRaw(result.patch),
          previewUrl: URL.createObjectURL(result.preview),
          colorCorrected: result.colorCorrected
        })
      }
      revokePartials(live())
      live().stage = 'done'
    } catch (err) {
      const friendly = describeError(err)
      if (friendly.aborted) {
        discard(layerId)
        return
      }
      if (jobs.value[layerId]) {
        live().stage = 'error'
        live().error = friendly
      }
      throw err
    }
  }

  function cancel(layerId: string): void {
    jobs.value[layerId]?.controller.abort()
  }

  /** 应用某个候选：补丁写入 IndexedDB，并作为可撤销的修改写入图层 */
  async function apply(layerId: string, index: number): Promise<void> {
    const editor = useEditorStore()
    const job = jobs.value[layerId]
    const candidate = job?.candidates[index]
    const meta = editor.project
    const layer = editor.layers.find(l => l.id === layerId)
    if (!job || !candidate || !meta || !layer) {
      throw new Error('候选结果已失效')
    }
    if (maskKey(layer.mask) !== job.maskSnapshot) {
      throw new Error('区域在生成后被修改，请重新生成')
    }
    const blobId = await putBlob(meta.id, candidate.patch)
    const { crop } = job.plan
    editor.setGenerativeResult(layerId, { blobId, x: crop.x, y: crop.y, w: crop.w, h: crop.h })
    discard(layerId)
  }

  function discard(layerId: string): void {
    const job = jobs.value[layerId]
    if (!job) {
      return
    }
    job.controller.abort()
    revokePartials(job)
    job.candidates.forEach(c => URL.revokeObjectURL(c.previewUrl))
    jobs.value = Object.fromEntries(Object.entries(jobs.value).filter(([id]) => id !== layerId))
  }

  function revokePartials(job: InpaintJob): void {
    job.partialUrls.forEach(url => url && URL.revokeObjectURL(url))
    job.partialUrls = []
  }

  function discardAll(): void {
    Object.keys(jobs.value).forEach(discard)
  }

  return { jobs, isRunning, run, cancel, apply, discard, discardAll }
})
