import type { LinearImage } from './high-depth'
import { linearToOklab } from './raw-look'

/**
 * 降噪用 à-trous B3 样条小波（Starck & Murtagh）：第 j 层的平滑核间隔 2^j 像素，细节 = 本层 − 下一层。
 * 噪声按层、按局部亮度（OKLab L）估计，阈值随亮度变化——暗部噪点通常更重。
 */
export const NOISE_LEVELS = 5
export const NOISE_BIN_CENTERS = [0.05, 0.15, 0.28, 0.42, 0.58, 0.75, 0.95]
/** 直接测量的层数；更粗的层纹理占比大、测不准，按测得的衰减比外推 */
const MEASURED_LEVELS = 3
/** 降噪强度 100 时的软阈值倍数（相对噪声标准差） */
const LUMA_STRENGTH = 3
const CHROMA_STRENGTH = 6
const MAD_TO_SIGMA = 1 / 0.6745

export interface NoiseProfile {
  /** [层][亮度箱]：全分辨率下 OKLab L 细节的噪声标准差 */
  luma: number[][]
  /** [层][亮度箱]：OKLab a / b 细节的噪声标准差 */
  chroma: number[][]
}

export interface NoiseThresholds {
  /** levels × bins，按层依次排列 */
  luma: Float32Array
  chroma: Float32Array
}

/** 一维 B3 样条平滑（边界复制），step 为采样间隔 */
function smooth(src: Float32Array, w: number, h: number, step: number): Float32Array {
  const weights = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16]
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let k = -2; k <= 2; k++) sum += weights[k + 2]! * src[y * w + Math.min(w - 1, Math.max(0, x + k * step))]!
      tmp[y * w + x] = sum
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let k = -2; k <= 2; k++) sum += weights[k + 2]! * tmp[Math.min(h - 1, Math.max(0, y + k * step)) * w + x]!
      out[y * w + x] = sum
    }
  }
  return out
}

function nearestBin(lightness: number): number {
  let best = 0
  for (let i = 1; i < NOISE_BIN_CENTERS.length; i++) {
    if (Math.abs(lightness - NOISE_BIN_CENTERS[i]!) < Math.abs(lightness - NOISE_BIN_CENTERS[best]!)) best = i
  }
  return best
}

function median(values: number[]): number {
  const sorted = Float64Array.from(values).sort()
  return sorted[Math.floor(sorted.length / 2)]!
}

/** 空箱取最近的有效箱；全空时为 0（视为无噪声，降噪不起作用） */
function fillBins(values: number[]): number[] {
  return values.map((v, i) => {
    if (Number.isFinite(v)) return v
    for (let d = 1; d < values.length; d++) {
      if (Number.isFinite(values[i - d] ?? NaN)) return values[i - d]!
      if (Number.isFinite(values[i + d] ?? NaN)) return values[i + d]!
    }
    return 0
  })
}

/** 估计时把细节分成 BLOCK × BLOCK 的小块，每块各自算标准差 */
const BLOCK = 8
/** 取各块标准差的这一分位：照片里总有平坦区域（天空、墙面、虚化背景），纹理多的块不参与 */
const BLOCK_QUANTILE = 0.2
/** 64 个样本的块估计有离散，低分位会偏小，按纯噪声的情况补回 */
const BLOCK_BIAS = 1.15

/**
 * 从全分辨率小块（线性 sRGB RGBA）估计噪声：每层细节按 8×8 小块取中位绝对偏差（Donoho 估计），
 * 每个亮度箱取各块结果的低分位，避免把纹理当成噪点。
 */
export function estimateNoise(tiles: LinearImage[]): NoiseProfile {
  const bins = NOISE_BIN_CENTERS.length
  const luma = Array.from({ length: MEASURED_LEVELS }, () => Array.from({ length: bins }, () => [] as number[]))
  const chroma = Array.from({ length: MEASURED_LEVELS }, () => Array.from({ length: bins }, () => [] as number[]))
  for (const tile of tiles) {
    const { width: w, height: h } = tile
    const planes: Float32Array[] = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)]
    for (let i = 0; i < w * h; i++) {
      const lab = linearToOklab(tile.data[i * 4]!, tile.data[i * 4 + 1]!, tile.data[i * 4 + 2]!)
      for (let c = 0; c < 3; c++) planes[c]![i] = lab[c]!
    }
    let fine = planes
    for (let level = 0; level < MEASURED_LEVELS; level++) {
      const step = 2 ** level
      const coarse: Float32Array[] = fine.map(plane => smooth(plane, w, h, step))
      // 跳过受边界复制影响的外圈（累计核半径）
      const margin = 2 * (2 * step - 1)
      for (let by = margin; by + BLOCK <= h - margin; by += BLOCK) {
        for (let bx = margin; bx + BLOCK <= w - margin; bx += BLOCK) {
          const dl: number[] = []
          const dc: number[] = []
          let lightness = 0
          for (let y = by; y < by + BLOCK; y++) {
            for (let x = bx; x < bx + BLOCK; x++) {
              const i = y * w + x
              lightness += coarse[0]![i]!
              dl.push(Math.abs(fine[0]![i]! - coarse[0]![i]!))
              dc.push(Math.abs(fine[1]![i]! - coarse[1]![i]!), Math.abs(fine[2]![i]! - coarse[2]![i]!))
            }
          }
          const bin = nearestBin(lightness / (BLOCK * BLOCK))
          luma[level]![bin]!.push(median(dl) * MAD_TO_SIGMA)
          chroma[level]![bin]!.push(median(dc) * MAD_TO_SIGMA)
        }
      }
      fine = coarse
    }
  }
  const lowQuantile = (values: number[]) => {
    const sorted = Float64Array.from(values).sort()
    return sorted[Math.floor((sorted.length - 1) * BLOCK_QUANTILE)]! * BLOCK_BIAS
  }
  const measure = (levels: number[][][]) => {
    const measured = levels.map(level => fillBins(level.map(values => values.length >= 4 ? lowQuantile(values) : NaN)))
    for (let level = MEASURED_LEVELS; level < NOISE_LEVELS; level++) {
      measured.push(measured[level - 1]!.map((sigma, bin) => {
        const ratio = measured[1]![bin]! > 0 ? measured[MEASURED_LEVELS - 1]![bin]! / measured[MEASURED_LEVELS - 2]![bin]! : 0.4
        return sigma * Math.min(0.6, Math.max(0.25, ratio))
      }))
    }
    return measured
  }
  return { luma: measure(luma), chroma: measure(chroma) }
}

/** 全分辨率某层（可为小数，超出已知层时按末两层的比例外推）的噪声标准差 */
function sigmaAt(levels: number[][], level: number, bin: number): number {
  const last = levels.length - 1
  if (level >= last) {
    const ratio = levels[last - 1]![bin]! > 0 ? Math.min(0.6, Math.max(0.25, levels[last]![bin]! / levels[last - 1]![bin]!)) : 0.4
    return levels[last]![bin]! * ratio ** (level - last)
  }
  const i = Math.floor(level)
  const f = level - i
  const a = levels[i]![bin]!
  const b = levels[i + 1]![bin]!
  return a > 0 && b > 0 ? a ** (1 - f) * b ** f : a * (1 - f) + b * f
}

/**
 * 当前渲染比例下各层各箱的软阈值。scale 为「渲染像素 / 全分辨率像素」（预览约 1/3，导出为 1）：
 * 缩小后的第 j 层对应全分辨率的第 j + log2(1/scale) 层，阈值随之变小，预览近似导出效果。
 * 强度都为 0 时返回 null，渲染器跳过整个降噪过程。
 */
export function noiseThresholds(profile: NoiseProfile, luminance: number, color: number, scale: number): NoiseThresholds | null {
  const l = Math.min(100, Math.max(0, luminance)) / 100 * LUMA_STRENGTH
  const c = Math.min(100, Math.max(0, color)) / 100 * CHROMA_STRENGTH
  if (!l && !c) return null
  const shift = Math.log2(1 / Math.min(1, Math.max(1e-3, scale)))
  const bins = NOISE_BIN_CENTERS.length
  const result: NoiseThresholds = { luma: new Float32Array(NOISE_LEVELS * bins), chroma: new Float32Array(NOISE_LEVELS * bins) }
  for (let level = 0; level < NOISE_LEVELS; level++) {
    for (let bin = 0; bin < bins; bin++) {
      result.luma[level * bins + bin] = l * sigmaAt(profile.luma, level + shift, bin)
      result.chroma[level * bins + bin] = c * sigmaAt(profile.chroma, level + shift, bin)
    }
  }
  return result
}

/** 分块导出时每侧需要的边距：各层平滑核半径之和 */
export const NOISE_PADDING = 2 * (2 ** NOISE_LEVELS - 1) + 2

/**
 * 导入时的默认强度：颜色降噪与 Lightroom 默认相同；亮度降噪按中间调噪点水平给。
 * 取中间调各箱的最小值（纹理只会把估计抬高）；样张实测 ISO 100 的单反、微单约 0.002–0.004（给 0），
 * ISO 400 的全画幅约 0.008、手机约 0.007（给 10 上下），再往上线性增加，最多 40。
 */
export function defaultNoiseStrength(profile: NoiseProfile): { luminance: number, color: number } {
  const sigma = Math.min(...profile.luma[0]!.slice(1, 5))
  return { luminance: Math.round(Math.min(40, Math.max(0, (sigma - 0.004) / 0.0004))), color: 25 }
}
