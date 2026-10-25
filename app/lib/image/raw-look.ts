import type { Rgb } from './hdr'
import { mapRgb, mapRgbInto } from './hdr'
import type { LinearImage } from './high-depth'
import { linearToSrgb8, srgbToLinear } from './high-depth'

/**
 * RAW 基础风格：camera 按相机内嵌预览拟合，standard 为通用曲线，none 保持线性数据（旧工程的外观）。
 * 风格只在出口（调整图层之后、SDR 肩部之前）施加，浮点主数据始终是场景线性值。
 */
export type RawLookStyle = 'camera' | 'standard' | 'none'

/** 增益曲线定义在 log2 场景亮度上（RAW 白电平约为 0 EV），每 1/8 EV 一个点。 */
export const LOOK_MIN_EV = -16
export const LOOK_MAX_EV = 6
export const LOOK_STEPS_PER_EV = 8
export const LOOK_POINTS = (LOOK_MAX_EV - LOOK_MIN_EV) * LOOK_STEPS_PER_EV + 1
/** 色度倍数按 OKLab 亮度 0、0.1 … 1.0 取 11 个点，相机通常中间调更艳、高光更淡 */
export const CHROMA_POINTS = 11

export interface RawLook {
  /** 各网格点的亮度增益（EV）；定义域外沿用两端的值，即按比例延伸，HDR 高光不会被压平 */
  gains: number[]
  /** 各亮度点的 OKLab 色度倍数（CHROMA_POINTS 个），亮度超出 0–1 时取两端 */
  chroma: number[]
}

/** 8 位 RGBA 预览（相机内嵌 JPEG 解码后） */
export interface PreviewPixels {
  data: ArrayLike<number>
  width: number
  height: number
}

/** 目标显示亮度的上限：再往上 SDR 肩部的逆趋于无穷，之后按比例延伸 */
const DISPLAY_MAX = 0.97
const MAX_GAIN_EV = 8
const LUMA: Rgb = [0.2126, 0.7152, 0.0722]

/** 通用曲线：典型测光下的中灰（0.125）显示为 0.19（sRGB 约 121），RAW 白电平显示为白。 */
const STANDARD_CONTRAST = 1.4
const STANDARD_PIVOT = 0.4481
/** 通用色度：中间调略提，亮度 0.7 以上逐渐回到原色度，避免高光发艳 */
const STANDARD_CHROMA = Array.from({ length: CHROMA_POINTS }, (_, i) => {
  const lightness = i / (CHROMA_POINTS - 1)
  return lightness <= 0.7 ? 1.1 : 1.1 - 0.1 * (lightness - 0.7) / 0.3
})

/** SDR 出口肩部（mapLuminance，拐点 0.5）的逆；v 须小于 1。 */
export function inverseShoulder(v: number): number {
  return v <= 0.5 ? Math.max(0, v) : 0.5 - 0.5 * Math.log(2 - 2 * v)
}

function gridEv(index: number): number {
  return LOOK_MIN_EV + index / LOOK_STEPS_PER_EV
}

/**
 * 由显示曲线 display（场景亮度 → SDR 显示亮度）构造增益：增益使「增益后的亮度经过出口肩部」等于 display，
 * 因此 SDR 输出贴合目标曲线，中间调与 HDR 输出一致，高光在 HDR 中保留余量。
 * [fromEv, toEv] 之外、以及目标亮度达到上限之后，沿用边界处的增益。
 */
function gainsFromDisplay(display: (y: number) => number, fromEv = LOOK_MIN_EV, toEv = LOOK_MAX_EV): number[] {
  const gains: number[] = []
  let saturated: number | null = null
  for (let i = 0; i < LOOK_POINTS; i++) {
    const ev = Math.min(toEv, Math.max(fromEv, gridEv(i)))
    if (saturated !== null) {
      gains.push(saturated)
      continue
    }
    const target = display(2 ** ev)
    const gain = Math.min(MAX_GAIN_EV, Math.max(-MAX_GAIN_EV, Math.log2(Math.max(inverseShoulder(Math.min(target, DISPLAY_MAX)), 1e-12)) - ev))
    if (target >= DISPLAY_MAX) saturated = gain
    gains.push(gain)
  }
  return gains
}

/** BaselineExposure 来自 DNG（相机厂商给的基准曝光补偿），非 DNG 为 0。 */
export function standardLook(baselineExposure = 0): RawLook {
  const shift = 2 ** baselineExposure
  const pivot = STANDARD_PIVOT ** STANDARD_CONTRAST
  return {
    gains: gainsFromDisplay((y) => {
      const x = (y * shift) ** STANDARD_CONTRAST
      return x * (1 + pivot) / (x + pivot)
    }),
    chroma: [...STANDARD_CHROMA]
  }
}

/** 色度倍数随 OKLab 亮度线性插值 */
export function lookChroma(look: RawLook, lightness: number): number {
  const t = Math.min(1, Math.max(0, lightness)) * (CHROMA_POINTS - 1)
  const i = Math.min(CHROMA_POINTS - 2, Math.floor(t))
  const f = t - i
  return look.chroma[i]! * (1 - f) + look.chroma[i + 1]! * f
}

/** 线性插值取增益（EV） */
export function lookGain(look: RawLook, luminance: number): number {
  const ev = luminance > 0 ? Math.log2(luminance) : LOOK_MIN_EV
  const t = (Math.min(LOOK_MAX_EV, Math.max(LOOK_MIN_EV, ev)) - LOOK_MIN_EV) * LOOK_STEPS_PER_EV
  const i = Math.min(LOOK_POINTS - 2, Math.floor(t))
  const f = t - i
  return look.gains[i]! * (1 - f) + look.gains[i + 1]! * f
}

/** 与着色器同一套 OKLab（立方根保留符号，扩展线性值与负色域分量都能往返） */
export function linearToOklab(r: number, g: number, b: number): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

export function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

/** 扩展线性 sRGB 上施加风格；与 ENCODE_FRAG 的实现逐项一致，供缩略图与「对比原图」使用。 */
export function applyLook(rgb: Rgb, look: RawLook): Rgb {
  const luminance = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2]
  const scale = 2 ** lookGain(look, luminance)
  const [r, g, b] = [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale]
  if (look.chroma.every(v => v === 1)) return [r, g, b]
  const lab = linearToOklab(r, g, b)
  const chroma = lookChroma(look, lab[0])
  return oklabToLinear(lab[0], lab[1] * chroma, lab[2] * chroma)
}

/** 线性 sRGB → 8 位 sRGB（RGBA），施加风格后经出口肩部；缩略图与「对比原图」用，与 GPU 出口一致 */
export function renderSdr(image: LinearImage, look: RawLook | null): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(image.width * image.height * 4)
  const sdr = new Float64Array(3)
  for (let p = 0; p < image.width * image.height; p++) {
    const rgb: Rgb = [image.data[p * 4]!, image.data[p * 4 + 1]!, image.data[p * 4 + 2]!]
    const styled = look ? applyLook(rgb, look) : rgb
    mapRgbInto(styled[0], styled[1], styled[2], sdr)
    for (let c = 0; c < 3; c++) out[p * 4 + c] = linearToSrgb8(sdr[c]!)
    out[p * 4 + 3] = 255
  }
  return out
}

/** 按面积平均缩小 RGBA；decode 把原始样本换成线性值（8 位预览用 sRGB 解码表） */
function downsample(data: ArrayLike<number>, width: number, height: number, longSide: number, decode?: Float32Array): LinearImage {
  const scale = Math.min(1, longSide / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const sum = new Float64Array(w * h * 3)
  const count = new Uint32Array(w * h)
  for (let y = 0; y < height; y++) {
    const row = Math.min(h - 1, Math.floor(y * h / height)) * w
    for (let x = 0; x < width; x++) {
      const bin = row + Math.min(w - 1, Math.floor(x * w / width))
      const p = (y * width + x) * 4
      for (let c = 0; c < 3; c++) sum[bin * 3 + c]! += decode ? decode[data[p + c]!]! : data[p + c]!
      count[bin]!++
    }
  }
  const out = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = sum[i * 3 + c]! / Math.max(1, count[i]!)
    out[i * 4 + 3] = 1
  }
  return { data: out, width: w, height: h }
}

/**
 * 去掉预览四周的黑边（部分相机把 3:2 画面放进 4:3 预览并补黑）。黑边是成对、等宽的纯黑带；
 * 只有一侧发黑（夜空、暗角）属于画面内容，不裁。
 */
function trimBorders(preview: PreviewPixels): PreviewPixels {
  const { data, width, height } = preview
  const black = (x0: number, y0: number, dx: number, dy: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const p = ((y0 + dy * i) * width + x0 + dx * i) * 4
      if (Math.max(data[p]!, data[p + 1]!, data[p + 2]!) > 6) return false
    }
    return true
  }
  const pair = (near: number, far: number) => near > 0 && far > 0 && Math.abs(near - far) <= Math.max(2, 0.1 * Math.max(near, far))
  let top = 0
  let bottom = 0
  let left = 0
  let right = 0
  while (top < height * 0.3 && black(0, top, 1, 0, width)) top++
  while (bottom < height * 0.3 && black(0, height - 1 - bottom, 1, 0, width)) bottom++
  if (!pair(top, bottom)) top = bottom = 0
  while (left < width * 0.3 && black(left, top, 0, 1, height - top - bottom)) left++
  while (right < width * 0.3 && black(width - 1 - right, top, 0, 1, height - top - bottom)) right++
  if (!pair(left, right)) left = right = 0
  if (!top && !left) return preview
  bottom = height - bottom
  right = width - right
  const w = right - left
  const h = bottom - top
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w * 4; x++) out[y * w * 4 + x] = data[((top + y) * width + left) * 4 + x]!
  }
  return { data: out, width: w, height: h }
}

function luminances(image: LinearImage): Float64Array {
  const values = new Float64Array(image.width * image.height)
  for (let i = 0; i < values.length; i++) {
    values[i] = LUMA[0] * image.data[i * 4]! + LUMA[1] * image.data[i * 4 + 1]! + LUMA[2] * image.data[i * 4 + 2]!
  }
  return values.sort()
}

function quantile(sorted: ArrayLike<number>, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!
}

/** 保序回归（相邻违序合并），让拟合出的曲线单调不降 */
function isotonic(values: number[], weights: number[]): number[] {
  const blocks: Array<{ value: number, weight: number, size: number }> = []
  values.forEach((value, i) => {
    blocks.push({ value, weight: weights[i]!, size: 1 })
    while (blocks.length > 1 && blocks.at(-2)!.value > blocks.at(-1)!.value) {
      const b = blocks.pop()!
      const a = blocks.pop()!
      const weight = a.weight + b.weight
      blocks.push({ value: (a.value * a.weight + b.value * b.weight) / weight, weight, size: a.size + b.size })
    }
  })
  return blocks.flatMap(block => Array<number>(block.size).fill(block.value))
}

const CHROMA_BANDS = 10

/**
 * 按亮度排名分成若干段：每段取 tone 之后的 OKLab 亮度均值（色度曲线按它索引）与 display 之后色度的截尾均值
 * （去掉两端各 10%，比中位数稳定，又不受零星高饱和小物体影响）。
 * 两张图亮度排名相同的像素是同一批景物（色调曲线单调），按段比较色度不受两边明暗曲线不同的影响。
 */
function chromaBands(image: LinearImage, tone: (rgb: Rgb) => Rgb, display: (rgb: Rgb) => Rgb): Array<{ lightness: number, chroma: number }> {
  const n = image.width * image.height
  const luminance = new Float64Array(n)
  const lightness = new Float64Array(n)
  const chroma = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const toned = tone([image.data[i * 4]!, image.data[i * 4 + 1]!, image.data[i * 4 + 2]!])
    const shown = display(toned)
    const lab = linearToOklab(...shown)
    luminance[i] = LUMA[0] * shown[0] + LUMA[1] * shown[1] + LUMA[2] * shown[2]
    lightness[i] = linearToOklab(...toned)[0]
    chroma[i] = Math.hypot(lab[1], lab[2])
  }
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => luminance[a]! - luminance[b]!)
  return Array.from({ length: CHROMA_BANDS }, (_, band) => {
    const members = order.subarray(Math.floor(band * n / CHROMA_BANDS), Math.floor((band + 1) * n / CHROMA_BANDS))
    const values = Float64Array.from(members, i => chroma[i]!).sort()
    const kept = values.subarray(Math.floor(values.length * 0.1), Math.ceil(values.length * 0.9))
    return {
      lightness: members.reduce((sum, i) => sum + lightness[i]!, 0) / Math.max(1, members.length),
      chroma: kept.reduce((sum, v) => sum + v, 0) / Math.max(1, kept.length)
    }
  })
}

/**
 * 预览相对场景（施加风格并经肩部后）的色度倍数，随亮度变化：各段之比落在该段的亮度上，再插值到 11 个点并平滑。
 * 很暗的段受 8 位量化与压缩噪声影响、接近白的段相机按通道截断、几乎无色的段比例不可靠，都不参与；
 * 预览几乎没有颜色（黑白风格）时保持原色度。
 */
function chromaCurve(source: LinearImage, target: LinearImage, look: RawLook): number[] {
  const unit = { ...look, chroma: new Array<number>(CHROMA_POINTS).fill(1) }
  const scene = chromaBands(source, rgb => applyLook(rgb, unit), mapRgb)
  const preview = chromaBands(target, rgb => rgb, rgb => rgb)
  const points: Array<{ lightness: number, ratio: number }> = []
  preview.forEach((band, i) => {
    if (band.lightness < 0.15 || band.lightness > 0.93 || scene[i]!.chroma < 0.01) return
    points.push({ lightness: scene[i]!.lightness, ratio: Math.min(1.6, Math.max(0.6, band.chroma / scene[i]!.chroma)) })
  })
  if (points.length < 2 || Math.max(...preview.map(band => band.chroma)) < 0.01) return new Array<number>(CHROMA_POINTS).fill(1)
  points.sort((a, b) => a.lightness - b.lightness)
  const knots = Array.from({ length: CHROMA_POINTS }, (_, k) => {
    const lightness = k / (CHROMA_POINTS - 1)
    if (lightness <= points[0]!.lightness) return points[0]!.ratio
    if (lightness >= points.at(-1)!.lightness) return points.at(-1)!.ratio
    const j = points.findIndex(p => p.lightness >= lightness)
    const a = points[j - 1]!
    const b = points[j]!
    return a.ratio + (b.ratio - a.ratio) * (lightness - a.lightness) / Math.max(1e-6, b.lightness - a.lightness)
  })
  return knots.map((v, k) => 0.25 * (knots[Math.max(0, k - 1)]! + knots[Math.min(CHROMA_POINTS - 1, k + 1)]!) + 0.5 * v)
}

const FIT_SIDE = 256
const FIT_BIN_EV = 0.25
const SRGB_DECODE = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255))

/**
 * 按相机内嵌预览拟合风格（直方图匹配，同 RawTherapee「自动匹配色调曲线」的思路）：
 * 两张图缩到同一尺寸，按分位数配对场景亮度与预览亮度，分箱取中位数、保序回归得到单调曲线；
 * 比配对范围更暗的部分沿暗部的斜率延伸（相机会把最暗处压黑）；更亮的部分在预览截白处推到白，
 * 再往上按比例延伸（SDR 与相机一样到白，HDR 高光保留余量）。
 * 预览太小、亮度范围太窄或结果离谱时返回 null，改用通用曲线。
 */
export function fitCameraLook(scene: LinearImage, preview: PreviewPixels): RawLook | null {
  if (preview.width * preview.height < 64 * 48) return null
  const trimmed = trimBorders(preview)
  const side = Math.min(FIT_SIDE, Math.max(trimmed.width, trimmed.height), Math.max(scene.width, scene.height))
  const target = downsample(trimmed.data, trimmed.width, trimmed.height, side, SRGB_DECODE)
  const source = downsample(scene.data, scene.width, scene.height, side)
  const ys = luminances(source)
  const yp = luminances(target)

  // 分位数配对；预览压到 sRGB 0 级或场景值无效的点不参与；预览开始截白处只记下场景亮度，曲线在那里推到白
  const bins = new Map<number, number[]>()
  let clipEv: number | null = null
  for (let q = 0.002; q <= 0.998; q += 1 / 512) {
    const x = quantile(ys, q)
    const y = quantile(yp, q)
    if (y >= DISPLAY_MAX && x > 1e-6) clipEv ??= Math.log2(x)
    if (x <= 1e-6 || y < SRGB_DECODE[1]! || y >= DISPLAY_MAX) continue
    const bin = Math.floor((Math.log2(x) - LOOK_MIN_EV) / FIT_BIN_EV)
    const list = bins.get(bin) ?? []
    list.push(Math.log2(y))
    bins.set(bin, list)
  }
  const keys = [...bins.keys()].sort((a, b) => a - b)
  if (keys.length < 8) return null
  const centers = keys.map(k => LOOK_MIN_EV + (k + 0.5) * FIT_BIN_EV)
  const medians = keys.map((k) => {
    const list = bins.get(k)!.sort((a, b) => a - b)
    return list[Math.floor(list.length / 2)]!
  })
  const curve = isotonic(medians, keys.map(k => bins.get(k)!.length))
  const fromEv = centers[0]!
  const toEv = centers.at(-1)!
  // 暗部斜率（对数坐标）取最暗几箱的平均，限定在 1…3：1 为按比例延伸，越大压得越黑
  const toeIndex = Math.min(3, centers.length - 1)
  const toe = Math.min(3, Math.max(1, (curve[toeIndex]! - curve[0]!) / (centers[toeIndex]! - fromEv)))
  // 预览截白的位置比最后一个有效点更亮时，在两者之间（对数坐标）推到白；否则按比例延伸
  const whiteEv = clipEv !== null && clipEv > toEv ? clipEv : null
  const display = (y: number) => {
    const ev = Math.log2(y)
    if (ev < fromEv) return 2 ** (curve[0]! + toe * (ev - fromEv))
    if (ev > toEv && whiteEv !== null) {
      const f = Math.min(1, (ev - toEv) / (whiteEv - toEv))
      return 2 ** (curve.at(-1)! * (1 - f) + Math.log2(DISPLAY_MAX) * f)
    }
    let i = 0
    while (i < centers.length - 2 && centers[i + 1]! < ev) i++
    const f = Math.min(1, Math.max(0, (ev - centers[i]!) / (centers[i + 1]! - centers[i]!)))
    return 2 ** (curve[i]! * (1 - f) + curve[i + 1]! * f)
  }
  const look: RawLook = { gains: gainsFromDisplay(display, LOOK_MIN_EV, whiteEv ?? toEv), chroma: new Array<number>(CHROMA_POINTS).fill(1) }

  // 合理性：场景中位亮度处的增益在 -2…+3 EV，中间调的对比（对数斜率）在 0.4…2.5
  const median = quantile(ys, 0.5)
  const medianGain = lookGain(look, median)
  const q25 = quantile(ys, 0.25)
  const q75 = quantile(ys, 0.75)
  const spread = Math.log2(q75 / q25)
  const slope = spread > 0.5 ? Math.log2(display(q75) / display(q25)) / spread : 1
  if (toEv - fromEv < 2 || medianGain < -2 || medianGain > 3 || slope < 0.4 || slope > 2.5) return null

  look.chroma = chromaCurve(source, target, look)
  return look
}
