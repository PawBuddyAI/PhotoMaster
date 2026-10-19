import { binarize, dilateBinary } from '../mask/ops'

/**
 * GPT Image 会重画整张输入图，蒙版外的内容也可能整体偏色。
 * 环带（编辑区外侧一圈、模型本应保持不变的像素）上生成图与原图的差异就代表这种漂移，
 * 这里在 CIELAB 空间按均值和标准差把生成图拉回原图的统计特征。
 */
export interface ColorMatchOptions {
  /** 环带宽度（像素） */
  ringWidth: number
  /** 环带像素过少时视为无法可靠估计，直接返回原生成图 */
  minRingPixels?: number
  /** 标准差缩放的允许范围，防止极端校正 */
  maxScale?: number
}

export interface ColorMatchResult {
  pixels: Uint8ClampedArray
  /** 是否实际做了校正 */
  applied: boolean
  ringPixels: number
}

/**
 * @param generated 生成图 RGBA（已缩放到与原图裁剪区域同尺寸）
 * @param original 原图裁剪区域 RGBA
 * @param editRegion 编辑区二值图（1 = 允许模型修改的区域）
 */
export function matchColorToSurroundings(
  generated: Uint8ClampedArray,
  original: Uint8ClampedArray,
  editRegion: Uint8Array,
  w: number,
  h: number,
  opts: ColorMatchOptions
): ColorMatchResult {
  const minRing = opts.minRingPixels ?? 64
  const maxScale = opts.maxScale ?? 2
  const dilated = dilateBinary(binarize(editRegion), w, h, opts.ringWidth)

  let ringCount = 0
  for (let i = 0; i < editRegion.length; i++) {
    if (dilated[i] && !editRegion[i]) ringCount++
  }
  if (ringCount < minRing) {
    return { pixels: generated.slice(), applied: false, ringPixels: ringCount }
  }

  // 环带像素很多时等间隔抽样，统计量足够稳定
  const stride = Math.max(1, Math.floor(ringCount / 200_000))
  const genStats = new LabStats()
  const origStats = new LabStats()
  const lab = new Float64Array(3)
  let seen = 0
  for (let i = 0; i < editRegion.length; i++) {
    if (!dilated[i] || editRegion[i]) continue
    if (seen++ % stride !== 0) continue
    const p = i * 4
    srgbToLab(generated[p]!, generated[p + 1]!, generated[p + 2]!, lab)
    genStats.add(lab)
    srgbToLab(original[p]!, original[p + 1]!, original[p + 2]!, lab)
    origStats.add(lab)
  }

  const gMean = genStats.mean()
  const gStd = genStats.std()
  const oMean = origStats.mean()
  const oStd = origStats.std()
  const scale = [0, 1, 2].map(c => gStd[c]! < 1e-3 ? 1 : clamp(oStd[c]! / gStd[c]!, 1 / maxScale, maxScale))

  const out = generated.slice()
  const rgb = new Float64Array(3)
  for (let i = 0; i < editRegion.length; i++) {
    if (!editRegion[i]) continue
    const p = i * 4
    srgbToLab(generated[p]!, generated[p + 1]!, generated[p + 2]!, lab)
    for (let c = 0; c < 3; c++) {
      lab[c] = (lab[c]! - gMean[c]!) * scale[c]! + oMean[c]!
    }
    labToSrgb(lab, rgb)
    out[p] = rgb[0]!
    out[p + 1] = rgb[1]!
    out[p + 2] = rgb[2]!
  }
  return { pixels: out, applied: true, ringPixels: ringCount }
}

class LabStats {
  private n = 0
  private sum = [0, 0, 0]
  private sumSq = [0, 0, 0]

  add(lab: Float64Array): void {
    this.n++
    for (let c = 0; c < 3; c++) {
      this.sum[c]! += lab[c]!
      this.sumSq[c]! += lab[c]! * lab[c]!
    }
  }

  mean(): number[] {
    return this.sum.map(s => s / this.n)
  }

  std(): number[] {
    return this.sum.map((s, c) => {
      const m = s / this.n
      return Math.sqrt(Math.max(0, this.sumSq[c]! / this.n - m * m))
    })
  }
}

const SRGB_TO_LINEAR = new Float64Array(256)
for (let i = 0; i < 256; i++) {
  const v = i / 255
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

// D65 白点
const XN = 0.95047
const YN = 1
const ZN = 1.08883

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116
}

function labFInv(t: number): number {
  const t3 = t * t * t
  return t3 > 216 / 24389 ? t3 : (116 * t - 16) / (24389 / 27)
}

export function srgbToLab(r: number, g: number, b: number, out: Float64Array): void {
  const lr = SRGB_TO_LINEAR[r]!
  const lg = SRGB_TO_LINEAR[g]!
  const lb = SRGB_TO_LINEAR[b]!
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / XN
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb) / YN
  const z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / ZN
  const fx = labF(x)
  const fy = labF(y)
  const fz = labF(z)
  out[0] = 116 * fy - 16
  out[1] = 500 * (fx - fy)
  out[2] = 200 * (fy - fz)
}

export function labToSrgb(lab: Float64Array, out: Float64Array): void {
  const fy = (lab[0]! + 16) / 116
  const fx = fy + lab[1]! / 500
  const fz = fy - lab[2]! / 200
  const x = labFInv(fx) * XN
  const y = labFInv(fy) * YN
  const z = labFInv(fz) * ZN
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  out[0] = linearToSrgb8(lr)
  out[1] = linearToSrgb8(lg)
  out[2] = linearToSrgb8(lb)
}

function linearToSrgb8(v: number): number {
  const c = clamp(v, 0, 1)
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.round(s * 255)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
