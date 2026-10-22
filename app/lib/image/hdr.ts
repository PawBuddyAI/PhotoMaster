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
export function srgbToRec2020(r: number, g: number, b: number): Rgb {
  return [0.627404 * r + 0.329283 * g + 0.043313 * b, 0.069097 * r + 0.91954 * g + 0.011362 * b, 0.016392 * r + 0.088013 * g + 0.895595 * b]
}
export function rec2020ToSrgb(r: number, g: number, b: number): Rgb {
  return [1.660491 * r - 0.587641 * g - 0.07285 * b, -0.12455 * r + 1.1329 * g - 0.008349 * b, -0.018151 * r - 0.100579 * g + 1.11873 * b]
}
/** 单调的肩部曲线，保留 0–0.5 的中间调，不直接裁掉高光。 */
export function mapLuminance(value: number, ceiling = 1): number {
  const knee = ceiling * 0.5
  return value <= knee ? Math.max(0, value) : knee + (ceiling - knee) * (1 - Math.exp(-(value - knee) / (ceiling - knee)))
}
/** 按亮度压缩并向中性轴压缩超色域颜色；仅在显示 / 交付出口调用。 */
export function mapRgb(rgb: Rgb, ceiling = 1, weights: Rgb = [0.2126, 0.7152, 0.0722]): Rgb {
  const lum = Math.max(0, weights[0] * rgb[0] + weights[1] * rgb[1] + weights[2] * rgb[2])
  const mapped = mapLuminance(lum, ceiling)
  const scaled = rgb.map(c => c * mapped / Math.max(lum, 1e-8))
  let saturation = 1
  for (const c of scaled) {
    if (c < 0) saturation = Math.min(saturation, mapped / (mapped - c))
    if (c > ceiling) saturation = Math.min(saturation, (ceiling - mapped) / (c - mapped))
  }
  return scaled.map(c => Math.min(ceiling, Math.max(0, mapped + (c - mapped) * saturation))) as unknown as Rgb
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
