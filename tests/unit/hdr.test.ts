import { describe, expect, it } from 'vitest'
import { normalizeHdr, nitsToPq, pqToNits, mapRgb, measureHeadroom, rec2020ToSrgb, srgbToRec2020 } from '../../app/lib/image/hdr'
import { type LinearImage, linearInfo, linearToSrgb8, packFloatLinear, readLinearRegion } from '../../app/lib/image/high-depth'
import { encodeExr } from '../../app/lib/image/exr'
import { readExr } from '../fixtures/exr'
import { normalizeDoc } from '../../app/lib/project/doc'

describe('HDR color and persistence', () => {
  it('preserves signed wide gamut and super-white values through storage and resampling', async () => {
    const values = [-0.1, 2, 8] as const
    const blob = packFloatLinear(2, 2, () => values)
    expect(await linearInfo(blob)).toMatchObject({ hdr: true, stride: 12, width: 2, height: 2 })
    const image = await readLinearRegion(blob, { x: 0, y: 0, w: 2, h: 2 }, 1, 1)
    const rgb = srgbToRec2020(image.data[0]!, image.data[1]!, image.data[2]!)
    rgb.forEach((v, i) => expect(v).toBeCloseTo(values[i]!, 4))
    expect(() => packFloatLinear(1, 1, () => [Infinity, 0, 1])).toThrow()
  })
  it('uses standard PQ luminance and monotonic SDR highlight mapping', () => {
    expect(nitsToPq(100)).toBeCloseTo(0.50807842, 7)
    expect(nitsToPq(1000)).toBeCloseTo(0.751827096, 7)
    for (const nits of [0, 0.01, 80, 203, 1000, 10000]) expect(pqToNits(nitsToPq(nits))).toBeCloseTo(nits, 6)
    const mapped = [0.1, 0.5, 1, 2, 4].map(v => mapRgb([v, v, v])[0])
    for (let i = 1; i < mapped.length; i++) expect(mapped[i]).toBeGreaterThan(mapped[i - 1]!)
    expect(mapRgb(rec2020ToSrgb(0, 2, 0)).every(v => v >= 0 && v <= 1)).toBe(true)
  })
  it('normalizes settings without changing legacy documents', () => {
    expect(normalizeDoc({}).hdr).toBeUndefined()
    expect(normalizeHdr({ referenceWhite: NaN, peakNits: -1 })).toEqual({ preview: 'auto', referenceWhite: 203, peakNits: 203 })
    expect(normalizeDoc({ hdr: { preview: 'sdr', referenceWhite: 100, peakNits: 2000 } }).hdr?.peakNits).toBe(2000)
  })
  it('writes valid EXR offsets, Rec.2020 chromaticities and unclipped FLOAT channels', async () => {
    async function* bands() {
      yield new Float32Array([-0.2, 2, 8, 1, 4, 4, 4, 1])
    }
    const blob = await encodeExr(1, 2, bands(), 203)
    const exr = readExr(new Uint8Array(await blob.arrayBuffer()))
    expect(exr.width).toBe(1)
    expect(exr.height).toBe(2)
    const expected = [...srgbToRec2020(-0.2, 2, 8), ...srgbToRec2020(4, 4, 4)]
    exr.rgb.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 5))
    expect(exr.attributes.get('whiteLuminance')!.readFloatLE()).toBe(203)
    expect(exr.attributes.get('chromaticities')!.readFloatLE()).toBeCloseTo(0.708)
  })
})

/** 单行图像：每段 [亮度, 像素数] 依次排开，RGB 相同 */
function grayRuns(runs: Array<[number, number]>): LinearImage {
  const values = runs.flatMap(([value, count]) => Array<number>(count).fill(value))
  const data = new Float32Array(values.length * 4)
  values.forEach((v, i) => data.set([v, v, v, 1], i * 4))
  return { data, width: values.length, height: 1 }
}

describe('measureHeadroom', () => {
  it('全部不超过参考白时没有余量', () => {
    expect(measureHeadroom(grayRuns([[0.2, 500], [0.99, 500]]))).toEqual({ aboveWhite: 0, aboveOneStop: 0, peakEv: 0 })
  })

  it('统计超过参考白、超过一档的占比，最亮处取第 0.1% 亮的像素', () => {
    // 2000 像素：第 3 亮（下标 floor(2000 × 0.001) = 2）落在 4 上
    const headroom = measureHeadroom(grayRuns([[0.5, 1800], [1.5, 150], [4, 50]]))
    expect(headroom.aboveWhite).toBeCloseTo(0.1, 10)
    expect(headroom.aboveOneStop).toBeCloseTo(0.025, 10)
    expect(headroom.peakEv).toBeCloseTo(2, 6)
  })

  it('少量热像素不抬高最亮处', () => {
    const headroom = measureHeadroom(grayRuns([[0.2, 9961], [2, 30], [64, 9]]))
    expect(headroom.peakEv).toBeCloseTo(1, 6)
    expect(headroom.aboveWhite).toBeCloseTo(39 / 10000, 10)
  })

  it('超过参考白的像素不到 0.1% 时最亮处记为 0', () => {
    const headroom = measureHeadroom(grayRuns([[0.3, 9995], [8, 5]]))
    expect(headroom.peakEv).toBe(0)
    expect(headroom.aboveWhite).toBeCloseTo(0.0005, 10)
  })

  it('按亮度判断，单个通道超过 1 不算超过参考白', () => {
    const data = new Float32Array([3, 0, 0, 1, 0, 1.2, 0, 1, 1.2, 1.2, 1.2, 1])
    expect(measureHeadroom({ data, width: 3, height: 1 }).aboveWhite).toBeCloseTo(1 / 3, 10)
  })

  it('读图提示词的描述与 SDR 肩部一致：参考白约 233，亮一档约 252', () => {
    expect(linearToSrgb8(mapRgb([1, 1, 1])[0])).toBe(233)
    expect(linearToSrgb8(mapRgb([2, 2, 2])[0])).toBe(252)
  })
})
