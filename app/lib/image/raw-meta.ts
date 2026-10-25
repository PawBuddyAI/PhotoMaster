import LibRaw, { type Metadata } from 'libraw-wasm'
import { RAW_SETTINGS } from './raw-settings'
import type { PreviewPixels } from './raw-look'

/** 拟合风格用的预览缩到这个长边以内（在解码 JPEG 时直接缩小，不展开全尺寸预览） */
export const PREVIEW_ANALYSIS_SIDE = 512

/** 相机内嵌预览（JPEG 或 8 位位图）→ RGBA；直方图匹配不在乎方向，按存储方向解码。读不出时返回 null。 */
export async function readPreview(decoder: LibRaw): Promise<PreviewPixels | null> {
  try {
    const thumb = await decoder.thumbnailData()
    if (!thumb?.data?.length || thumb.width <= 0 || thumb.height <= 0) return null
    if (thumb.format === 'bitmap' && thumb.data.length >= thumb.width * thumb.height * 3) {
      const data = new Uint8ClampedArray(thumb.width * thumb.height * 4)
      for (let i = 0; i < thumb.width * thumb.height; i++) data.set([thumb.data[i * 3]!, thumb.data[i * 3 + 1]!, thumb.data[i * 3 + 2]!, 255], i * 4)
      return { data, width: thumb.width, height: thumb.height }
    }
    if (thumb.format !== 'jpeg') return null
    const scale = Math.min(1, PREVIEW_ANALYSIS_SIDE / Math.max(thumb.width, thumb.height))
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(thumb.data)], { type: 'image/jpeg' }), {
      imageOrientation: 'none',
      resizeWidth: Math.max(1, Math.round(thumb.width * scale)),
      resizeHeight: Math.max(1, Math.round(thumb.height * scale)),
      resizeQuality: 'medium'
    })
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    bitmap.close()
    return { data: pixels.data, width: pixels.width, height: pixels.height }
  } catch (error) {
    // 预览坏了只影响风格拟合，退回通用曲线
    console.warn('RAW preview unavailable', error)
    return null
  }
}

/**
 * 从保存的 RAW 原件读完整元数据，可选读内嵌预览；不解码像素（LibRaw open 只解析结构，约零点几秒）。
 * 导出时写 EXIF、旧工程补算风格都走这里。
 */
export async function readRawMetadata(file: Blob, withPreview = false): Promise<{ metadata: Metadata, preview: PreviewPixels | null }> {
  const decoder = new LibRaw()
  try {
    await decoder.open(new Uint8Array(await file.arrayBuffer()), RAW_SETTINGS)
    const metadata = await decoder.metadata(true)
    if (!metadata || metadata.width <= 0) throw new Error('读不出这张 RAW 的拍摄信息。')
    return { metadata, preview: withPreview ? await readPreview(decoder) : null }
  } finally {
    decoder.dispose()
  }
}
