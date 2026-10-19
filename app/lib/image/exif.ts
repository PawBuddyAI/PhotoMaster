import piexif from 'piexifjs'
import { binaryStringToBytes, bytesToBinaryString } from './canvas'

/**
 * 读取 JPEG 原图的 EXIF，并为导出做准备：方向重置为 1（像素已按方向校正）、
 * 去掉缩略图（与新图不符）、更新像素尺寸。非 JPEG 或没有 EXIF 时返回 null。
 */
export async function prepareExportExif(original: Blob, width: number, height: number): Promise<string | null> {
  if (original.type !== 'image/jpeg') {
    return null
  }
  try {
    const binary = bytesToBinaryString(new Uint8Array(await original.arrayBuffer()))
    const exif = piexif.load(binary)
    const hasData = ['0th', 'Exif', 'GPS'].some(key => Object.keys((exif as Record<string, object | undefined>)[key] ?? {}).length > 0)
    if (!hasData) {
      return null
    }
    exif['0th'] = { ...exif['0th'], [piexif.ImageIFD.Orientation]: 1 }
    exif.Exif = {
      ...exif.Exif,
      [piexif.ExifIFD.PixelXDimension]: width,
      [piexif.ExifIFD.PixelYDimension]: height
    }
    exif['1st'] = {}
    delete exif.thumbnail
    return piexif.dump(exif)
  } catch {
    // EXIF 损坏或含有 piexif 不支持的标签时放弃写回，不影响导出
    return null
  }
}

export async function insertExif(jpeg: Blob, exif: string): Promise<Blob> {
  const binary = bytesToBinaryString(new Uint8Array(await jpeg.arrayBuffer()))
  return new Blob([binaryStringToBytes(piexif.insert(exif, binary))], { type: 'image/jpeg' })
}
