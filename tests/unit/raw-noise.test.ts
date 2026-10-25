import { describe, expect, it } from 'vitest'
import type { LinearImage } from '~/lib/image/high-depth'
import { oklabToLinear } from '~/lib/image/raw-look'
import { defaultNoiseStrength, estimateNoise, NOISE_BIN_CENTERS, NOISE_LEVELS, noiseThresholds, type NoiseProfile } from '~/lib/image/raw-noise'

/** 可复现的高斯随机数（Box-Muller + 线性同余） */
function gaussian(seed: number) {
  let state = seed
  const uniform = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return (state + 0.5) / 2147483648
  }
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform())
}

/** 直接在 OKLab 中构造小块：lightness(x, y) 给出无噪声的亮度，再叠加亮度 / 色度噪声 */
function tile(lightness: (x: number, y: number) => number, sigmaL: number, sigmaC: number, seed: number, size = 64): LinearImage {
  const random = gaussian(seed)
  const data = new Float32Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = oklabToLinear(lightness(x, y) + sigmaL * random(), sigmaC * random(), sigmaC * random())
      data.set([...rgb, 1], (y * size + x) * 4)
    }
  }
  return { data, width: size, height: size }
}

/** B3 à-trous 第 0 层细节对单位白噪声的标准差 */
const LEVEL0_WHITE = 0.8907

describe('噪声估计', () => {
  it('平坦区域：第 0 层的估计与白噪声理论值一致', () => {
    const tiles = Array.from({ length: 8 }, (_, i) => tile(() => 0.42, 0.01, 0.004, i + 1))
    const profile = estimateNoise(tiles)
    const bin = NOISE_BIN_CENTERS.indexOf(0.42)
    expect(profile.luma[0]![bin]! / (0.01 * LEVEL0_WHITE)).toBeGreaterThan(0.85)
    expect(profile.luma[0]![bin]! / (0.01 * LEVEL0_WHITE)).toBeLessThan(1.15)
    expect(profile.chroma[0]![bin]! / (0.004 * LEVEL0_WHITE)).toBeGreaterThan(0.85)
    expect(profile.chroma[0]![bin]! / (0.004 * LEVEL0_WHITE)).toBeLessThan(1.15)
    // 更粗的层噪声逐层减小
    for (let level = 1; level < NOISE_LEVELS; level++) expect(profile.luma[level]![bin]!).toBeLessThan(profile.luma[level - 1]![bin]!)
  })

  it('一半是细密纹理时，估计仍贴近真实噪声，不把纹理当噪点', () => {
    const textured = (x: number, y: number) => 0.42 + (x < 32 ? 0.08 * Math.sin(x * 2.1) * Math.cos(y * 1.7) : 0)
    const profile = estimateNoise(Array.from({ length: 8 }, (_, i) => tile(textured, 0.01, 0.004, i + 11)))
    const bin = NOISE_BIN_CENTERS.indexOf(0.42)
    expect(profile.luma[0]![bin]! / (0.01 * LEVEL0_WHITE)).toBeLessThan(1.3)
  })

  it('按亮度分箱：暗部噪点更重时暗部的估计更大，空箱取相邻箱的值', () => {
    const dark = Array.from({ length: 6 }, (_, i) => tile(() => 0.15, 0.03, 0.01, i + 21))
    const bright = Array.from({ length: 6 }, (_, i) => tile(() => 0.75, 0.005, 0.002, i + 31))
    const profile = estimateNoise([...dark, ...bright])
    const at = (l: number) => profile.luma[0]![NOISE_BIN_CENTERS.indexOf(l)]!
    expect(at(0.15)).toBeGreaterThan(at(0.75) * 4)
    expect(at(0.05)).toBe(at(0.15))
    expect(at(0.95)).toBe(at(0.75))
  })
})

describe('降噪阈值', () => {
  const profile: NoiseProfile = {
    luma: Array.from({ length: NOISE_LEVELS }, (_, level) => NOISE_BIN_CENTERS.map(() => 0.01 * 0.4 ** level)),
    chroma: Array.from({ length: NOISE_LEVELS }, (_, level) => NOISE_BIN_CENTERS.map(() => 0.004 * 0.4 ** level))
  }

  it('两项强度都为 0 时关闭降噪', () => {
    expect(noiseThresholds(profile, 0, 0, 1)).toBeNull()
  })

  it('阈值随强度线性增加；导出（比例 1）时第 0 层对应全分辨率第 0 层', () => {
    const half = noiseThresholds(profile, 50, 0, 1)!
    const full = noiseThresholds(profile, 100, 0, 1)!
    expect(full.luma[0]).toBeCloseTo(half.luma[0]! * 2, 6)
    // 强度 100 时软阈值为 3 倍噪声标准差
    expect(full.luma[0]).toBeCloseTo(0.01 * 3, 6)
    expect(Array.from(full.chroma).every(v => v === 0)).toBe(true)
  })

  it('预览缩小 4 倍：第 0 层取全分辨率第 2 层的噪声（缩小后噪点已被平均掉一部分）', () => {
    const preview = noiseThresholds(profile, 100, 100, 0.25)!
    const exported = noiseThresholds(profile, 100, 100, 1)!
    expect(preview.luma[0]).toBeCloseTo(exported.luma[2 * NOISE_BIN_CENTERS.length]!, 9)
    // 超出已知层数时按末两层的比例外推
    expect(preview.luma[(NOISE_LEVELS - 1) * NOISE_BIN_CENTERS.length]).toBeCloseTo(3 * 0.01 * 0.4 ** (NOISE_LEVELS + 1), 9)
  })

  it('默认强度：噪点很轻时不开亮度降噪，颜色降噪固定 25；噪点重时亮度降噪随之提高', () => {
    expect(defaultNoiseStrength({ ...profile, luma: profile.luma.map(level => level.map(v => v / 10)) })).toEqual({ luminance: 0, color: 25 })
    const noisy = defaultNoiseStrength({ ...profile, luma: profile.luma.map(level => level.map(v => v * 3)) })
    expect(noisy.luminance).toBeGreaterThan(20)
    expect(noisy.color).toBe(25)
  })
})
