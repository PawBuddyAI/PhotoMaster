import type { RawImageData } from 'libraw-wasm'
import type { PixelRect } from '../types'
import { RAW_MAX_PIXELS, RAW_MAX_PIXELS_LABEL } from './raw-settings'
import { createCanvas, get2d } from './canvas'
import type { PatchSource } from './compose'
import { rec2020ToSrgbInto } from './hdr'

/** 持久化格式 v1：16 字节头 + RGB unsigned 16-bit little-endian，线性 sRGB。 */
const MAGIC = 0x314c3652 // R6L1
const FLOAT_MAGIC = 0x324c3352 // R3L2: RGB Float32 little endian, linear Rec.2020
const HEADER = 16
export const LINEAR_RGB16_TYPE = 'application/x-photomaster-rgb16'
export const LINEAR_RGB32_TYPE = 'application/x-photomaster-rgb32'
export interface LinearImage { data: Float32Array<ArrayBuffer>, width: number, height: number }

export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

const SRGB8_STEPS = 65535
let srgb8: Uint8Array | null = null

/** 线性 0–1 → 8 位 sRGB 码值（查 65536 级表，与 Math.round(linearToSrgb(v) * 255) 相差不超过 1）；逐像素大循环用 */
export function linearToSrgb8(value: number): number {
  srgb8 ??= Uint8Array.from({ length: SRGB8_STEPS + 1 }, (_, i) => Math.round(linearToSrgb(i / SRGB8_STEPS) * 255))
  return srgb8[Math.round(Math.min(1, Math.max(0, value)) * SRGB8_STEPS)]!
}

function checkSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > RAW_MAX_PIXELS) {
    throw new Error(`高位深图像尺寸无效或超过 ${RAW_MAX_PIXELS_LABEL}。`)
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
  const { width, height } = await linearInfo(blob)
  return { width, height }
}

export function packFloatLinear(width: number, height: number, sample: (pixel: number) => ArrayLike<number>): Blob {
  checkSize(width, height)
  const header = new ArrayBuffer(HEADER)
  const view = new DataView(header)
  view.setUint32(0, FLOAT_MAGIC, true)
  view.setUint32(4, width, true)
  view.setUint32(8, height, true)
  view.setUint32(12, 2020, true)
  const parts: BlobPart[] = [header]
  for (let first = 0; first < width * height; first += 65536) {
    const count = Math.min(65536, width * height - first)
    const data = new DataView(new ArrayBuffer(count * 12))
    for (let p = 0; p < count; p++) {
      const rgb = sample(first + p)
      for (let c = 0; c < 3; c++) {
        if (!Number.isFinite(Math.fround(rgb[c]!))) throw new Error('HDR 底图含有无效像素。')
        data.setFloat32(p * 12 + c * 4, rgb[c]!, true)
      }
    }
    parts.push(data.buffer)
  }
  return new Blob(parts, { type: LINEAR_RGB32_TYPE })
}

export async function linearInfo(blob: Blob): Promise<{ width: number, height: number, hdr: boolean, stride: number }> {
  if (blob.size < HEADER) throw new Error('高位深底图数据不完整。')
  const view = new DataView(await blob.slice(0, HEADER).arrayBuffer())
  const width = view.getUint32(4, true)
  const height = view.getUint32(8, true)
  checkSize(width, height)
  const hdr = view.getUint32(0, true) === FLOAT_MAGIC
  const stride = hdr ? 12 : 6
  if ((!hdr && view.getUint32(0, true) !== MAGIC) || view.getUint32(12, true) !== (hdr ? 2020 : 3) || blob.size !== HEADER + width * height * stride) {
    throw new Error('高位深底图格式无效或数据不完整。')
  }
  return { width, height, hdr, stride }
}

/** 分条读取并在线性空间面积重采样；原尺寸输出逐样本保真，预览不会先经过 8 位画布。 */
export async function readLinearRegion(blob: Blob, region: PixelRect, outW: number, outH: number): Promise<LinearImage> {
  const { width, height, hdr, stride } = await linearInfo(blob)
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
  // 这里是打开 RAW 工程和导出每一块时最重的循环：样本直接以类型化数组读取（文件是小端，与运行平台一致），
  // 颜色写进同一个复用的数组，不为每个像素新建对象
  const rgb = new Float64Array(3)
  const unit = sx === 1 && sy === 1
  // 横向每个输出像素覆盖哪些源列、各占多宽，每一行都一样，先算好：第 x 个像素用 tapStart[x] 到 tapStart[x + 1] 之间的几项
  const area = sx * sy
  const tapStart = new Int32Array(outW + 1)
  const tapColumn = new Int32Array(unit ? 0 : outW * (Math.ceil(sx) + 1))
  const tapWidth = new Float64Array(tapColumn.length)
  for (let x = 0, t = 0; !unit && x < outW; x++) {
    const x0 = x * sx
    const x1 = Math.min(region.w, (x + 1) * sx)
    for (let ix = Math.floor(x0); ix < Math.ceil(x1); ix++, t++) {
      tapColumn[t] = ix
      tapWidth[t] = Math.min(x1, ix + 1) - Math.max(x0, ix)
    }
    tapStart[x + 1] = t
  }
  for (let first = 0; first < outH; first += batchRows) {
    const last = Math.min(outH, first + batchRows)
    const rowStart = Math.floor(first * sy)
    const rowEnd = Math.min(region.h, Math.ceil(last * sy))
    const start = HEADER + (region.y + rowStart) * width * stride
    const buffer = await blob.slice(start, HEADER + (region.y + rowEnd) * width * stride).arrayBuffer()
    const floats = hdr ? new Float32Array(buffer) : null
    const words = hdr ? null : new Uint16Array(buffer)
    /** 读出第 src 个样本起的一个像素（线性 sRGB）到 rgb */
    const read = (src: number): void => {
      if (floats) {
        rec2020ToSrgbInto(floats[src]!, floats[src + 1]!, floats[src + 2]!, rgb)
        // 任一分量为 NaN 或无穷时，三者之和也不是有限数
        if (!Number.isFinite(rgb[0]! + rgb[1]! + rgb[2]!)) throw new Error('HDR 底图含有无效像素。')
      } else {
        rgb[0] = words![src]! / 65535
        rgb[1] = words![src + 1]! / 65535
        rgb[2] = words![src + 2]! / 65535
      }
    }
    for (let y = first; y < last; y++) {
      if (unit) {
        // 原尺寸（导出）：每个输出像素正好对应一个源像素，直接拷贝
        let src = ((y - rowStart) * width + region.x) * 3
        let dest = y * outW * 4
        for (let x = 0; x < outW; x++, src += 3, dest += 4) {
          read(src)
          data[dest] = rgb[0]!
          data[dest + 1] = rgb[1]!
          data[dest + 2] = rgb[2]!
          data[dest + 3] = 1
        }
        continue
      }
      const y0 = y * sy
      const y1 = Math.min(region.h, (y + 1) * sy)
      for (let iy = Math.floor(y0); iy < Math.ceil(y1); iy++) {
        const wy = Math.min(y1, iy + 1) - Math.max(y0, iy)
        const row = ((iy - rowStart) * width + region.x) * 3
        for (let x = 0, dest = y * outW * 4; x < outW; x++, dest += 4) {
          for (let t = tapStart[x]!; t < tapStart[x + 1]!; t++) {
            const weight = wy * tapWidth[t]! / area
            read(row + tapColumn[t]! * 3)
            data[dest] = data[dest]! + rgb[0]! * weight
            data[dest + 1] = data[dest + 1]! + rgb[1]! * weight
            data[dest + 2] = data[dest + 2]! + rgb[2]! * weight
          }
        }
      }
      for (let x = 0, dest = y * outW * 4 + 3; x < outW; x++, dest += 4) {
        data[dest] = 1
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
    const dx = (patch.x - region.x) * sx
    const dy = (patch.y - region.y) * sy
    const dw = patch.w * sx
    const dh = patch.h * sy
    ctx.clearRect(0, 0, base.width, base.height)
    ctx.drawImage(patch.image, dx, dy, dw, dh)
    // 只读回补丁落到的那一块：其余位置 alpha 为 0，本来也不会改动
    const left = Math.max(0, Math.floor(dx))
    const top = Math.max(0, Math.floor(dy))
    const w = Math.min(base.width, Math.ceil(dx + dw)) - left
    const h = Math.min(base.height, Math.ceil(dy + dh)) - top
    if (w <= 0 || h <= 0) continue
    const pixels = ctx.getImageData(left, top, w, h).data
    for (let y = 0; y < h; y++) {
      let src = y * w * 4
      let dest = ((top + y) * base.width + left) * 4
      for (let x = 0; x < w; x++, src += 4, dest += 4) {
        const alpha = pixels[src + 3]! / 255
        if (!alpha) continue
        for (let c = 0; c < 3; c++) data[dest + c] = data[dest + c]! * (1 - alpha) + SRGB8_TO_LINEAR[pixels[src + c]!]! * alpha
      }
    }
  }
  return { ...base, data }
}

/** 8 位 sRGB 码值 → 线性（与 srgbToLinear(v / 255) 相同） */
const SRGB8_TO_LINEAR = Float64Array.from({ length: 256 }, (_, v) => srgbToLinear(v / 255))
