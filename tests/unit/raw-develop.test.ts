import { describe, expect, it } from 'vitest'
import { rec2020ToSrgb } from '~/lib/image/hdr'
import { linearInfo, packFloatLinear } from '~/lib/image/high-depth'
import {
  baselineExposureOf,
  createSceneCollector,
  createTileCollector,
  defaultRawDevelop,
  normalizeRawDevelop,
  RAW_DEVELOP_OFF,
  type RawProfile,
  readNoiseTiles,
  resolveLook
} from '~/lib/image/raw-develop'
import { CHROMA_POINTS, LOOK_POINTS, standardLook } from '~/lib/image/raw-look'
import { NOISE_BIN_CENTERS, NOISE_LEVELS } from '~/lib/image/raw-noise'

function profile(camera: RawProfile['camera'], sigma = 0.001): RawProfile {
  const levels = Array.from({ length: NOISE_LEVELS }, () => NOISE_BIN_CENTERS.map(() => sigma))
  return { camera, baselineExposure: 0.5, noise: { luma: levels, chroma: levels } }
}

describe('RAW 基础设置', () => {
  it('规范化：认不出的风格当作不加处理，强度限制在 0–100', () => {
    expect(normalizeRawDevelop(undefined)).toEqual(RAW_DEVELOP_OFF)
    expect(normalizeRawDevelop({ look: 'vivid' as never, noise: { luminance: 140, color: -5 } })).toEqual({ look: 'none', noise: { luminance: 100, color: 0 } })
    expect(normalizeRawDevelop({ look: 'standard' })).toEqual({ look: 'standard', noise: { luminance: 0, color: 0 } })
  })

  it('新导入：有相机风格时默认用它，没有时用标准', () => {
    const camera = { gains: new Array(LOOK_POINTS).fill(0.3), chroma: new Array(CHROMA_POINTS).fill(1.1) }
    expect(defaultRawDevelop(profile(camera)).look).toBe('camera')
    expect(defaultRawDevelop(profile(null))).toEqual({ look: 'standard', noise: { luminance: 0, color: 25 } })
  })

  it('解析风格：不加处理为 null；选了相机直出但没有相机风格时退回标准；旧工程未分析时为 null', () => {
    const camera = { gains: new Array(LOOK_POINTS).fill(0.3), chroma: new Array(CHROMA_POINTS).fill(1.1) }
    expect(resolveLook({ look: 'none', noise: { luminance: 0, color: 0 } }, profile(camera))).toBeNull()
    expect(resolveLook({ look: 'camera', noise: { luminance: 0, color: 0 } }, profile(camera))).toBe(camera)
    expect(resolveLook({ look: 'camera', noise: { luminance: 0, color: 0 } }, profile(null))).toEqual(standardLook(0.5))
    expect(resolveLook({ look: 'standard', noise: { luminance: 0, color: 0 } }, undefined)).toBeNull()
  })

  it('BaselineExposure：LibRaw 用 -999 表示没有，按 0 处理', () => {
    expect(baselineExposureOf(-999)).toBe(0)
    expect(baselineExposureOf(undefined)).toBe(0)
    expect(baselineExposureOf(0.9)).toBe(0.9)
  })
})

describe('解码时的收集', () => {
  it('缩小图按面积平均，并换到目标色彩空间', () => {
    const scene = createSceneCollector(4, 2, 2)
    for (let p = 0; p < 8; p++) scene.add(p, [p, 0, 0])
    const image = scene.image((r, g, b) => [r, g, b])
    expect([image.width, image.height]).toEqual([2, 1])
    expect(image.data[0]).toBeCloseTo((0 + 1 + 4 + 5) / 4, 9)
    expect(image.data[4]).toBeCloseTo((2 + 3 + 6 + 7) / 4, 9)
  })

  it('画面比 5×4 个小块还小时减少块数，块互不重叠、每个像素都填满', () => {
    const collector = createTileCollector(128, 96)
    for (let p = 0; p < 128 * 96; p++) collector.add(p, [1, 1, 1])
    const tiles = collector.images((r, g, b) => [r, g, b])
    expect(tiles.map(tile => [tile.width, tile.height])).toEqual([[64, 64], [64, 64]])
    for (const tile of tiles) expect(tile.data.every(v => v === 1)).toBe(true)
    // 比一个小块还小的画面：整幅作为一块
    expect(createTileCollector(40, 30).images((r, g, b) => [r, g, b]).map(tile => [tile.width, tile.height])).toEqual([[40, 30]])
  })

  it('噪声小块：解码时收集的与从已存主数据读回的一致', async () => {
    const width = 400
    const height = 300
    const value = (p: number) => [((p * 37) % 101) / 101, ((p * 13) % 97) / 97, ((p * 7) % 89) / 89] as const
    const collector = createTileCollector(width, height)
    for (let p = 0; p < width * height; p++) collector.add(p, value(p))
    const collected = collector.images(rec2020ToSrgb)
    const linear = packFloatLinear(width, height, value)
    expect((await linearInfo(linear)).hdr).toBe(true)
    const stored = await readNoiseTiles(linear)
    expect(stored).toHaveLength(collected.length)
    expect(collected[0]!.width).toBe(64)
    stored.forEach((tile, i) => {
      for (let k = 0; k < tile.data.length; k += 997) expect(tile.data[k]).toBeCloseTo(collected[i]!.data[k]!, 4)
    })
  })
})
