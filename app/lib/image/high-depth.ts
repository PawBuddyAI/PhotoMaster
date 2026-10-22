import type { RawImageData } from 'libraw-wasm'
import type { PixelRect } from '../types'
import { RAW_MAX_PIXELS } from './raw-settings'
import { createCanvas, get2d } from './canvas'
import type { PatchSource } from './compose'

/** 持久化格式 v1：16 字节头 + RGB unsigned 16-bit little-endian，线性 sRGB。 */
const MAGIC = 0x314c3652 // R6L1
const HEADER = 16
export const LINEAR_RGB16_TYPE = 'application/x-photomaster-rgb16'
export interface LinearImage { data: Float32Array<ArrayBuffer>, width: number, height: number }

export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function checkSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > RAW_MAX_PIXELS) {
    throw new Error('高位深图像尺寸无效或超过 6000 万像素。')
  }
}

/** 拒绝错误位深 / 样本类型，避免把字节误读为 16 位样本。 */
export function packRawLinear(image: RawImageData): Blob {
  checkSize(image.width, image.height)
  if (image.bits !== 16 || !(image.data instanceof Uint16Array) || ![1, 3, 4].includes(image.colors)
    || image.data.length !== image.width * image.height * image.colors) {
    throw new Error('RAW 16 位解码结果不完整。')
  }
  const buffer = new ArrayBuffer(HEADER + image.width * image.height * 6)
  const view = new DataView(buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, image.width, true)
  view.setUint32(8, image.height, true)
  view.setUint32(12, 3, true)
  for (let p = 0; p < image.width * image.height; p++) {
    for (let c = 0; c < 3; c++) {
      view.setUint16(HEADER + p * 6 + c * 2, image.data[p * image.colors + (image.colors === 1 ? 0 : c)]!, true)
    }
  }
  return new Blob([buffer], { type: LINEAR_RGB16_TYPE })
}

export async function linearSize(blob: Blob): Promise<{ width: number, height: number }> {
  if (blob.size < HEADER) throw new Error('高位深底图数据不完整。')
  const view = new DataView(await blob.slice(0, HEADER).arrayBuffer())
  const width = view.getUint32(4, true)
  const height = view.getUint32(8, true)
  checkSize(width, height)
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(12, true) !== 3 || blob.size !== HEADER + width * height * 6) {
    throw new Error('高位深底图格式无效或数据不完整。')
  }
  return { width, height }
}

/** 分条读取并在线性空间面积重采样；原尺寸输出逐样本保真，预览不会先经过 8 位画布。 */
export async function readLinearRegion(blob: Blob, region: PixelRect, outW: number, outH: number): Promise<LinearImage> {
  const { width, height } = await linearSize(blob)
  checkSize(outW, outH)
  if (![region.x, region.y, region.w, region.h].every(Number.isInteger)
    || region.x < 0 || region.y < 0 || region.w <= 0 || region.h <= 0
    || region.x + region.w > width || region.y + region.h > height || outW > region.w || outH > region.h) {
    throw new Error('高位深采样区域无效。')
  }
  const data = new Float32Array(outW * outH * 4)
  const sx = region.w / outW
  const sy = region.h / outH
  // 每批最多读取约 32 行，避免把完整 60MP 底图额外展开到内存。
  const batchRows = Math.max(1, Math.floor(32 / sy))
  for (let first = 0; first < outH; first += batchRows) {
    const last = Math.min(outH, first + batchRows)
    const rowStart = Math.floor(first * sy)
    const rowEnd = Math.min(region.h, Math.ceil(last * sy))
    const start = HEADER + (region.y + rowStart) * width * 6
    const rows = new DataView(await blob.slice(start, HEADER + (region.y + rowEnd) * width * 6).arrayBuffer())
    for (let y = first; y < last; y++) {
      const y0 = y * sy
      const y1 = Math.min(region.h, (y + 1) * sy)
      for (let x = 0; x < outW; x++) {
        const x0 = x * sx
        const x1 = Math.min(region.w, (x + 1) * sx)
        const dest = (y * outW + x) * 4
        for (let iy = Math.floor(y0); iy < Math.ceil(y1); iy++) {
          const wy = Math.min(y1, iy + 1) - Math.max(y0, iy)
          for (let ix = Math.floor(x0); ix < Math.ceil(x1); ix++) {
            const weight = wy * (Math.min(x1, ix + 1) - Math.max(x0, ix)) / (sx * sy * 65535)
            const src = ((iy - rowStart) * width + region.x + ix) * 6
            for (let c = 0; c < 3; c++) data[dest + c] = data[dest + c]! + rows.getUint16(src + c * 2, true) * weight
          }
        }
        data[dest + 3] = 1
      }
    }
  }
  return { data, width: outW, height: outH }
}

/** AI 补丁本身为 8 位，逐层转线性后合成；透明区域保留原底图精度。 */
export function composeLinear(base: LinearImage, patches: PatchSource[], region: PixelRect): LinearImage {
  if (!patches.length) return base
  const data = base.data.slice()
  const canvas = createCanvas(base.width, base.height)
  const ctx = get2d(canvas, true)
  const sx = base.width / region.w
  const sy = base.height / region.h
  for (const patch of patches) {
    if (patch.x >= region.x + region.w || patch.y >= region.y + region.h
      || patch.x + patch.w <= region.x || patch.y + patch.h <= region.y) continue
    ctx.clearRect(0, 0, base.width, base.height)
    ctx.drawImage(patch.image, (patch.x - region.x) * sx, (patch.y - region.y) * sy, patch.w * sx, patch.h * sy)
    const pixels = ctx.getImageData(0, 0, base.width, base.height).data
    for (let i = 0; i < data.length; i += 4) {
      const alpha = pixels[i + 3]! / 255
      if (!alpha) continue
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c]! * (1 - alpha) + srgbToLinear(pixels[i + c]! / 255) * alpha
    }
  }
  return { ...base, data }
}
