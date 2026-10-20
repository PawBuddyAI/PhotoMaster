import * as Comlink from 'comlink'
import { ref } from 'vue'
import { type DialogFilter, isDesktop, pickSavePath, writeBlob } from '~/lib/desktop'
import type { ExportFormat, ExportResult } from '~/lib/image/export'
import { defaultExportOptions, type ExportOptions, FORMAT_EXTENSIONS } from '~/lib/image/export-options'
import { getBlob } from '~/lib/storage/db'
import { useEditorStore } from '~/stores/editor'
import { useImageWorker } from './useImageWorker'
import { useProjectAssets } from './useProjectAssets'

export interface ExportOutcome extends ExportResult {
  /** 桌面版写入的文件路径；网页版交给浏览器下载，为 null */
  savedPath: string | null
}

export interface SaveOutcome extends ExportResult {
  /** 写入的文件路径 */
  savedPath: string
  /** 是否写回了工程记着的原图位置（没有的话是这次新选的位置） */
  overwrote: boolean
  /** 工程记着的位置写不进去、改存到了 savedPath 时，这里是原来的位置 */
  failedPath?: string
}

/** 完成提示里的一行摘要：输出尺寸与文件大小 */
export function exportSummary(outcome: ExportResult): string {
  return `${outcome.width}×${outcome.height}，${(outcome.blob.size / 1024 / 1024).toFixed(1)} MB`
}

// 状态全局共享：「保存」按钮与导出弹窗都从这里得知是否正在渲染，避免两处同时导出
const exporting = ref(false)
const progress = ref(0)

const FORMAT_NAMES: Record<ExportFormat, string> = {
  'image/jpeg': 'JPEG 图像',
  'image/png': 'PNG 图像',
  'image/webp': 'WebP 图像'
}

/** 另存为对话框里的文件类型 */
function fileTypeOf(format: ExportFormat): DialogFilter {
  return { name: FORMAT_NAMES[format], extensions: FORMAT_EXTENSIONS[format] }
}

/**
 * 全分辨率导出与保存：在 Worker 中分块渲染。
 * - run（导出）：网页版完成后触发浏览器下载；桌面版先弹出另存为对话框再渲染，取消时返回 null，不做无用的渲染。
 * - save（桌面版的「保存」）：保存工程，并把结果写回原图文件。
 */
export function useExport() {
  /** 保存工程后，按原图分辨率渲染所有图层与裁剪 */
  async function render(opts: ExportOptions): Promise<ExportResult> {
    const editor = useEditorStore()
    const original = useProjectAssets().originalBlob.value
    if (!editor.project || !original) {
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

      return await useImageWorker().renderExport({
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
    } finally {
      exporting.value = false
    }
  }

  async function run(opts: ExportOptions): Promise<ExportOutcome | null> {
    const meta = useEditorStore().project
    if (!meta) {
      throw new Error('工程尚未打开')
    }
    const fileType = fileTypeOf(opts.format)
    const fileName = `${meta.name}-edited.${fileType.extensions[0]}`
    const desktop = isDesktop()
    const savedPath = desktop ? await pickSavePath(fileName, fileType) : null
    if (desktop && !savedPath) {
      return null
    }
    const result = await render(opts)
    if (savedPath) {
      await writeBlob(savedPath, result.blob)
    } else {
      downloadBlob(result.blob, fileName)
    }
    return { ...result, savedPath }
  }

  /**
   * 桌面版的「保存」：先保存工程，再把结果写回工程记着的原图文件（从文件对话框导入时记下的位置）。
   * 没有记着的位置（拖入、网页版导入、旧工程）时弹出另存为对话框，选定的位置从此作为这张照片的文件；
   * 记着的位置写不进去（文件夹被移走、文件被占用）时同样请用户另选位置。另存为取消时返回 null。
   * 格式跟着文件扩展名走，每次都从工程里保留的未修改原图重新渲染，反复保存不会累积压缩损失。
   */
  async function save(): Promise<SaveOutcome | null> {
    const editor = useEditorStore()
    const meta = editor.project
    if (!meta) {
      throw new Error('工程尚未打开')
    }
    const failure: { path?: string, error?: unknown } = {}
    if (meta.filePath) {
      const result = await render(defaultExportOptions(meta.originalType, meta.filePath))
      try {
        await writeBlob(meta.filePath, result.blob)
        return { ...result, savedPath: meta.filePath, overwrote: true }
      } catch (error) {
        failure.path = meta.filePath
        failure.error = error
      }
    }
    const { format } = defaultExportOptions(meta.originalType)
    const savedPath = await pickSavePath(`${meta.name}.${FORMAT_EXTENSIONS[format][0]}`, fileTypeOf(format))
    if (!savedPath) {
      if (failure.error) {
        throw failure.error
      }
      return null
    }
    const result = await render(defaultExportOptions(meta.originalType, savedPath))
    await writeBlob(savedPath, result.blob)
    await editor.setFilePath(savedPath)
    return { ...result, savedPath, overwrote: false, ...(failure.path ? { failedPath: failure.path } : {}) }
  }

  return { exporting, progress, run, save }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
