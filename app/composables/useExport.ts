import * as Comlink from 'comlink'
import { ref } from 'vue'
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

const EXTENSIONS: Record<ExportFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

/** 全分辨率导出：在 Worker 中分块渲染，完成后触发浏览器下载 */
export function useExport() {
  const exporting = ref(false)
  const progress = ref(0)

  async function run(opts: ExportOptions): Promise<ExportResult> {
    const editor = useEditorStore()
    const assets = useProjectAssets()
    const meta = editor.project
    const original = assets.originalBlob.value
    if (!meta || !original) {
      throw new Error('工程尚未打开')
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
      downloadBlob(result.blob, `${meta.name}-edited.${EXTENSIONS[opts.format]}`)
      return result
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
