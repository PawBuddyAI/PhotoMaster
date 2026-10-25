/** HDR 主数据用线性 Rec.2020；调色器用扩展线性 sRGB（允许负值和 >1），两者均为 D65。 */
export type Rgb = readonly [number, number, number]
export interface HdrSettings {
  preview: 'auto' | 'sdr'
  referenceWhite: number
  peakNits: number
}
export const DEFAULT_HDR: HdrSettings = { preview: 'auto', referenceWhite: 203, peakNits: 1000 }
export function normalizeHdr(value?: Partial<HdrSettings>): HdrSettings {
  const finite = (v: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(v) ? Math.min(max, Math.max(min, v!)) : fallback
  const referenceWhite = finite(value?.referenceWhite, 203, 80, 400)
  return { preview: value?.preview === 'sdr' ? 'sdr' : 'auto', referenceWhite, peakNits: finite(value?.peakNits, 1000, referenceWhite, 10000) }
}
/** 线性 sRGB ↔ 线性 Rec.2020（行优先 3×3） */
const SRGB_TO_REC2020 = [0.627404, 0.329283, 0.043313, 0.069097, 0.91954, 0.011362, 0.016392, 0.088013, 0.895595] as const
const REC2020_TO_SRGB = [1.660491, -0.587641, -0.07285, -0.12455, 1.1329, -0.008349, -0.018151, -0.100579, 1.11873] as const
function multiply(m: readonly number[], r: number, g: number, b: number): Rgb {
  return [m[0]! * r + m[1]! * g + m[2]! * b, m[3]! * r + m[4]! * g + m[5]! * b, m[6]! * r + m[7]! * g + m[8]! * b]
}
function multiplyInto(m: readonly number[], r: number, g: number, b: number, out: Float64Array): void {
  out[0] = m[0]! * r + m[1]! * g + m[2]! * b
  out[1] = m[3]! * r + m[4]! * g + m[5]! * b
  out[2] = m[6]! * r + m[7]! * g + m[8]! * b
}
export function srgbToRec2020(r: number, g: number, b: number): Rgb {
  return multiply(SRGB_TO_REC2020, r, g, b)
}
export function rec2020ToSrgb(r: number, g: number, b: number): Rgb {
  return multiply(REC2020_TO_SRGB, r, g, b)
}
/** 不分配版本：逐像素大循环把结果写进复用的数组 */
export function srgbToRec2020Into(r: number, g: number, b: number, out: Float64Array): void {
  multiplyInto(SRGB_TO_REC2020, r, g, b, out)
}
export function rec2020ToSrgbInto(r: number, g: number, b: number, out: Float64Array): void {
  multiplyInto(REC2020_TO_SRGB, r, g, b, out)
}
/** 单调的肩部曲线，保留 0–0.5 的中间调，不直接裁掉高光。 */
export function mapLuminance(value: number, ceiling = 1): number {
  const knee = ceiling * 0.5
  return value <= knee ? Math.max(0, value) : knee + (ceiling - knee) * (1 - Math.exp(-(value - knee) / (ceiling - knee)))
}
/** 按亮度压缩并向中性轴压缩超色域颜色；仅在显示 / 交付出口调用。 */
export function mapRgb(rgb: Rgb, ceiling = 1, weights: Rgb = [0.2126, 0.7152, 0.0722]): Rgb {
  const out = new Float64Array(3)
  mapRgbInto(rgb[0], rgb[1], rgb[2], out, ceiling, weights)
  return [out[0]!, out[1]!, out[2]!]
}

/** mapRgb 的不分配版本，结果写入 out；逐像素的大循环（RAW 解码）用它，避免每像素产生临时数组 */
export function mapRgbInto(r: number, g: number, b: number, out: Float64Array, ceiling = 1, weights: Rgb = [0.2126, 0.7152, 0.0722]): void {
  const lum = Math.max(0, weights[0] * r + weights[1] * g + weights[2] * b)
  const mapped = mapLuminance(lum, ceiling)
  const scale = mapped / Math.max(lum, 1e-8)
  out[0] = r * scale
  out[1] = g * scale
  out[2] = b * scale
  let saturation = 1
  for (let c = 0; c < 3; c++) {
    const v = out[c]!
    if (v < 0) saturation = Math.min(saturation, mapped / (mapped - v))
    if (v > ceiling) saturation = Math.min(saturation, (ceiling - mapped) / (v - mapped))
  }
  for (let c = 0; c < 3; c++) out[c] = Math.min(ceiling, Math.max(0, mapped + (out[c]! - mapped) * saturation))
}
/** ST 2084: absolute luminance (nits) ↔ PQ code value. */
export function nitsToPq(nits: number): number {
  const y = (Math.max(0, Math.min(10000, nits)) / 10000) ** (2610 / 16384)
  return ((3424 / 4096 + 2413 / 128 * y) / (1 + 2392 / 128 * y)) ** (2523 / 32)
}
export function pqToNits(code: number): number {
  const y = Math.max(0, Math.min(1, code)) ** (32 / 2523)
  return 10000 * (Math.max(0, y - 3424 / 4096) / (2413 / 128 - 2392 / 128 * y)) ** (16384 / 2610)
}
