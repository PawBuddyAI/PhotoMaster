import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { type AnyCanvas, get2d } from '~/lib/image/canvas'
import { composeBase } from '~/lib/image/compose'
import { composeLinear } from '~/lib/image/high-depth'
import { rasterizeMask, rasterizeMaskFloat } from '~/lib/mask/rasterize'
import { isFullMask, maskKey } from '~/lib/mask/spec'
import { buildRenderLayers } from '~/lib/pipeline/layers'
import { PhotoRenderer } from '~/lib/pipeline/renderer'
import type { MaskSpec, PixelRect } from '~/lib/types'
import { useEditorStore } from '~/stores/editor'
import { PREVIEW_LONG_SIDE, useProjectAssets } from './useProjectAssets'

/** 预览蒙版的长边上限：蒙版多为平滑过渡，较低分辨率线性放大即可，换取拖动区域时的流畅度 */
const MASK_LONG_SIDE = 1024
const MASK_CACHE_LIMIT = 48
const OVERLAY_COLOR = [239, 68, 68] as const
const OVERLAY_ALPHA = 0.45

export type EditorView = ReturnType<typeof useEditorRenderer>

/**
 * 编辑器预览管线：底图（原图 + 生成补丁）只在补丁变化时重建，
 * 调整图层的修改只触发 GPU 重新处理；所有渲染合并到下一帧执行。
 */
export function useEditorRenderer() {
  const editor = useEditorStore()
  const assets = useProjectAssets()

  const displayCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const originalPreview = shallowRef<AnyCanvas | null>(null)
  const overlayCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const frame = ref(0)
  const overlayFrame = ref(0)
  const overlayVisible = ref(false)
  const ready = ref(false)
  const error = ref<string | null>(null)

  let renderer: PhotoRenderer | null = null
  let imageW = 0
  let imageH = 0
  let previewW = 0
  let previewH = 0
  let maskW = 0
  let maskH = 0
  let fullRegion: PixelRect = { x: 0, y: 0, w: 0, h: 0 }
  let baseKey: string | null = null
  let rafId = 0
  let rendering = false
  let pending = false
  let disposed = false
  const maskCache = new Map<string, Uint8Array | Float32Array>()

  function init(): void {
    const meta = editor.project
    const original = assets.requireOriginal()
    if (!meta) {
      throw new Error('工程尚未打开')
    }
    imageW = meta.width
    imageH = meta.height
    fullRegion = { x: 0, y: 0, w: imageW, h: imageH }
    const scale = Math.min(1, PREVIEW_LONG_SIDE / Math.max(imageW, imageH))
    previewW = Math.max(1, Math.round(imageW * scale))
    previewH = Math.max(1, Math.round(imageH * scale))
    const maskScale = Math.min(1, MASK_LONG_SIDE / Math.max(previewW, previewH))
    maskW = Math.max(1, Math.round(previewW * maskScale))
    maskH = Math.max(1, Math.round(previewH * maskScale))

    originalPreview.value = composeBase(original, [], fullRegion, previewW, previewH)
    const canvas = document.createElement('canvas')
    renderer = new PhotoRenderer(canvas, !!assets.linearPreview.value)
    displayCanvas.value = canvas
    const overlay = document.createElement('canvas')
    overlay.width = maskW
    overlay.height = maskH
    overlayCanvas.value = overlay
    baseKey = null
    ready.value = true
    schedule()
    updateOverlay()
  }

  function rasterCached(spec: MaskSpec): Uint8Array | Float32Array {
    const key = maskKey(spec)
    const hit = maskCache.get(key)
    if (hit) {
      // 重新插入以维持“最近使用”顺序
      maskCache.delete(key)
      maskCache.set(key, hit)
      return hit
    }
    const rasterize = assets.linearPreview.value ? rasterizeMaskFloat : rasterizeMask
    const data = rasterize(spec, imageW, imageH, fullRegion, maskW, maskH)
    maskCache.set(key, data)
    if (maskCache.size > (data instanceof Float32Array ? MASK_CACHE_LIMIT / 4 : MASK_CACHE_LIMIT)) {
      maskCache.delete(maskCache.keys().next().value!)
    }
    return data
  }

  async function render(): Promise<void> {
    if (!renderer || disposed) {
      return
    }
    if (renderer.isContextLost()) {
      // GPU 上下文丢失（驱动重置、显存回收）时换一块新画布重建渲染器
      const canvas = document.createElement('canvas')
      renderer = new PhotoRenderer(canvas, !!assets.linearPreview.value)
      displayCanvas.value = canvas
      baseKey = null
    }
    const layers = editor.layers
    const nextBaseKey = JSON.stringify(layers.flatMap(l =>
      l.kind === 'generative' && l.enabled && l.result ? [l.result] : []))
    if (nextBaseKey !== baseKey) {
      const patches = await assets.patchSources(layers)
      if (disposed || !renderer) {
        return
      }
      if (assets.linearPreview.value) {
        const base = composeLinear(assets.linearPreview.value, patches, fullRegion)
        renderer.setLinearSource(base.data, base.width, base.height)
      } else {
        const base = composeBase(assets.requireOriginal(), patches, fullRegion, previewW, previewH)
        renderer.setSource(base, previewW, previewH)
      }
      baseKey = nextBaseKey
    }
    const adjustLayers = editor.layers.flatMap(l => l.kind === 'adjust' && l.enabled ? [l] : [])
    const renderLayers = buildRenderLayers(adjustLayers, imageW, imageH, fullRegion, maskW, maskH, 'preview', rasterCached)
    renderer.process(renderLayers, Math.max(previewW, previewH))
    renderer.present()
    frame.value++
  }

  function schedule(): void {
    if (!ready.value || disposed) {
      return
    }
    if (rendering) {
      pending = true
      return
    }
    if (rafId) {
      return
    }
    rafId = requestAnimationFrame(async () => {
      rafId = 0
      rendering = true
      try {
        await render()
        error.value = null
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
      } finally {
        rendering = false
        if (pending) {
          pending = false
          schedule()
        }
      }
    })
  }

  /** 当前需要叠加显示的蒙版：悬停建议优先，其次是选中图层 */
  function overlaySpec(): MaskSpec | null {
    if (editor.hoverMask) {
      return editor.hoverMask
    }
    const layer = editor.selectedLayer
    // 全图蒙版的叠加只会把整张图染红，没有提示价值；已应用的重绘结果不应被叠加层遮住
    if (!editor.showMaskOverlay || !layer || editor.tool === 'crop' || isFullMask(layer.mask)
      || (layer.kind === 'generative' && layer.result)) {
      return null
    }
    return layer.mask
  }

  function updateOverlay(): void {
    const canvas = overlayCanvas.value
    const spec = ready.value ? overlaySpec() : null
    if (!canvas || !spec) {
      overlayVisible.value = false
      overlayFrame.value++
      return
    }
    const data = rasterCached(spec)
    const ctx = get2d(canvas)
    const image = ctx.createImageData(maskW, maskH)
    const [r, g, b] = OVERLAY_COLOR
    const alphaScale = (data instanceof Float32Array ? 255 : 1) * OVERLAY_ALPHA
    for (let i = 0; i < data.length; i++) {
      const p = i * 4
      image.data[p] = r
      image.data[p + 1] = g
      image.data[p + 2] = b
      image.data[p + 3] = data[i]! * alphaScale
    }
    ctx.putImageData(image, 0, 0)
    overlayVisible.value = true
    overlayFrame.value++
  }

  watch(() => editor.layers, schedule, { deep: true })
  watch(
    () => [editor.hoverMask, editor.selectedLayer?.mask, editor.showMaskOverlay, editor.tool, ready.value],
    updateOverlay,
    { deep: true }
  )

  function dispose(): void {
    disposed = true
    if (rafId) {
      cancelAnimationFrame(rafId)
    }
    renderer?.dispose()
    renderer = null
    maskCache.clear()
    ready.value = false
  }

  onBeforeUnmount(dispose)

  return {
    displayCanvas,
    originalPreview,
    overlayCanvas,
    overlayVisible,
    frame,
    overlayFrame,
    ready,
    error,
    init,
    dispose
  }
}
