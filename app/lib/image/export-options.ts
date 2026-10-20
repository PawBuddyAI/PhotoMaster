import type { ExportFormat } from './export'

/** 导出参数：导出弹窗由用户选择，桌面版的「保存」直接用 defaultExportOptions */
export interface ExportOptions {
  format: ExportFormat
  quality: number
  keepExif: boolean
}

export const DEFAULT_EXPORT_QUALITY = 0.92

/** 各导出格式的文件扩展名（小写，不带点）；第一个用作默认文件名的后缀。导入时由扩展名反推格式也用它 */
export const FORMAT_EXTENSIONS: Record<ExportFormat, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp']
}

/** 路径最后一段（Windows 的 \ 与 / 都算分隔符） */
export function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

/** 由文件扩展名判断图片格式；不是 JPEG / PNG / WebP 时返回 null */
export function formatFromPath(path: string): ExportFormat | null {
  const extension = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase()
  const entry = Object.entries(FORMAT_EXTENSIONS).find(([, extensions]) => extension && extensions.includes(extension))
  return (entry?.[0] as ExportFormat | undefined) ?? null
}

/**
 * 「保存」写入某个文件时的参数：格式跟着文件的扩展名走（扩展名认不出时沿用原图格式，原图格式也不在
 * JPEG / PNG / WebP 内时用 JPEG），质量与导出弹窗的默认值一致。只有 JPEG 原图存成 JPEG 时才有 EXIF 可保留。
 */
export function defaultExportOptions(originalType: string, path?: string): ExportOptions {
  const fallback = originalType in FORMAT_EXTENSIONS ? originalType as ExportFormat : 'image/jpeg'
  const format = (path ? formatFromPath(path) : null) ?? fallback
  return { format, quality: DEFAULT_EXPORT_QUALITY, keepExif: format === 'image/jpeg' && originalType === 'image/jpeg' }
}
