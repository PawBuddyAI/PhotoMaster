import { canvasToBlob, createCanvas, get2d } from './canvas'
import { insertExif } from './exif'
import { linearToSrgb } from './high-depth'
import { mapRgb, nitsToPq, srgbToRec2020, type HdrSettings } from './hdr'

export async function* pqBands(bands: AsyncIterable<Float32Array>, settings: HdrSettings): AsyncGenerator<Uint16Array> {
  for await (const band of bands) {
    const result = new Uint16Array(band.length / 4 * 3)
    for (let p = 0; p < band.length / 4; p++) {
      const rgb = mapRgb(srgbToRec2020(band[p * 4]!, band[p * 4 + 1]!, band[p * 4 + 2]!), settings.peakNits / settings.referenceWhite, [0.2627, 0.678, 0.0593])
      for (let c = 0; c < 3; c++) result[p * 3 + c] = Math.round(nitsToPq(rgb[c]! * settings.referenceWhite) * 65535)
    }
    yield result
  }
}

/**
 * JPEG/R 双层：兼容 SDR 的基础 JPEG + RGB 对数增益图，交给 libultrahdr 写 XMP / MPF。
 * exif（piexif 格式）先插进基础 JPEG，组装时会被挪到首段并据此计算 MPF 偏移。
 */
export async function encodeUltraHdr(width: number, height: number, bands: AsyncIterable<Float32Array>, settings: HdrSettings, quality: number, exif?: string): Promise<Blob> {
  const ceiling = settings.peakNits / settings.referenceWhite
  // Conservative fixed bounds cover all tone-mapped RGB ratios, including gamut compression.
  const min = -8
  const max = Math.log2((ceiling + 1 / 64) * 64)
  const sdr = createCanvas(width, height)
  const gain = createCanvas(width, height)
  const sdrCtx = get2d(sdr)
  const gainCtx = get2d(gain)
  let y = 0
  for await (const band of bands) {
    const rows = band.length / (width * 4)
    const base = new Uint8ClampedArray(band.length)
    const map = new Uint8ClampedArray(band.length)
    for (let p = 0; p < band.length; p += 4) {
      const rgb = [band[p]!, band[p + 1]!, band[p + 2]!] as const
      const low = mapRgb(rgb)
      const high = mapRgb(rgb, ceiling)
      for (let c = 0; c < 3; c++) {
        base[p + c] = Math.round(linearToSrgb(low[c]!) * 255)
        const boost = Math.log2((high[c]! + 1 / 64) / (low[c]! + 1 / 64))
        map[p + c] = Math.round(Math.max(0, Math.min(1, (boost - min) / (max - min))) * 255)
      }
      base[p + 3] = 255
      map[p + 3] = 255
    }
    sdrCtx.putImageData(new ImageData(base, width, rows), 0, y)
    gainCtx.putImageData(new ImageData(map, width, rows), 0, y)
    y += rows
  }
  if (y !== height) throw new Error('Ultra HDR 像素数量不匹配。')
  const compress = async (canvas: typeof sdr, metadata?: string) => {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    return {
      data: new Uint8Array(await (metadata ? await insertExif(blob, metadata) : blob).arrayBuffer()),
      mimeType: 'image/jpeg' as const, width, height
    }
  }
  const { encodeJPEGMetadata } = await import('@monogrid/gainmap-js/libultrahdr')
  const jpeg = encodeJPEGMetadata({
    sdr: await compress(sdr, exif), gainMap: await compress(gain),
    gamma: [1, 1, 1], gainMapMin: [min, min, min], gainMapMax: [max, max, max],
    hdrCapacityMin: 0, hdrCapacityMax: Math.max(0.01, Math.log2(ceiling)),
    offsetSdr: [1 / 64, 1 / 64, 1 / 64], offsetHdr: [1 / 64, 1 / 64, 1 / 64]
  })
  return new Blob([jpeg], { type: 'image/jpeg' })
}
