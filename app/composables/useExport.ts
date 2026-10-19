import * as Comlink from 'comlink'
import { ref } from 'vue'
import { type DialogFilter, isDesktop, pickSavePath, writeBlob } from '~/lib/desktop'
import type { ExportFormat, ExportResult } from '~/lib/image/export'
import { getBlob } from '~/lib/storage/db'
import { useEditorStore } from '~/stores/editor'
import { useImageWorker } from './useImageWorker'
import { useProjectAssets } from './useProjectAssets'

export interface ExportOptions {
  format: ExportFormat
  quality: number
  keepExif: boolean
}

export interface ExportOutcome extends ExportResult {
  /** 桌面版写入的文件路径；网页版交给浏览器下载，为 null */
  savedPath: string | null
}

/** 各格式在另存为对话框中的类型；第一个扩展名用作默认文件名的后缀 */
const FILE_TYPES: Record<ExportFormat, DialogFilter> = {
  'image/jpeg': { name: 'JPEG 图像', extensions: ['jpg', 'jpeg'] },
  'image/png': { name: 'PNG 图像', extensions: ['png'] },
  'image/webp': { name: 'WebP 图像', extensions: ['webp'] }
}

/**
 * 全分辨率导出：在 Worker 中分块渲染。网页版完成后触发浏览器下载；
 * 桌面版先弹出另存为对话框再渲染，取消时返回 null，不做无用的渲染。
 */
export function useExport() {
  const exporting = ref(false)
  const progress = ref(0)

  async function run(opts: ExportOptions): Promise<ExportOutcome | null> {
    const editor = useEditorStore()
    const assets = useProjectAssets()
    const meta = editor.project
    const original = assets.originalBlob.value
    if (!meta || !original) {
      throw new Error('工程尚未打开')
    }
    const fileType = FILE_TYPES[opts.format]
    const fileName = `${meta.name}-edited.${fileType.extensions[0]}`
    const desktop = isDesktop()
    const savedPath = desktop ? await pickSavePath(fileName, fileType) : null
    if (desktop && !savedPath) {
      return null
    }
    exporting.value = true
    progress.value = 0
    try {
      await editor.flush()
      // 跨线程传递前剥离响应式代理
      const doc = JSON.parse(JSON.stringify(editor.doc)) as typeof editor.doc
      const patches = await Promise.all(doc.layers.flatMap(layer =>
        layer.kind === 'generative' && layer.enabled && layer.result
          ? [layer.result]
          : []).map(async r => ({ blob: await getBlob(r.blobId), x: r.x, y: r.y, w: r.w, h: r.h })))
      const layers = doc.layers.flatMap(layer =>
        layer.kind === 'adjust' && layer.enabled ? [{ params: layer.params, mask: layer.mask }] : [])

      const result = await useImageWorker().renderExport({
        original,
        patches,
        layers,
        crop: doc.crop,
        format: opts.format,
        quality: opts.quality,
        keepExif: opts.keepExif
      }, Comlink.proxy((done: number, total: number) => {
        progress.value = done / total
      }))
      if (savedPath) {
        await writeBlob(savedPath, result.blob)
      } else {
        downloadBlob(result.blob, fileName)
      }
      return { ...result, savedPath }
    } finally {
      exporting.value = false
    }
  }

  return { exporting, progress, run }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
