import { describe, expect, it } from 'vitest'
import { normalizeHdr, nitsToPq, pqToNits, mapRgb, rec2020ToSrgb, srgbToRec2020 } from '../../app/lib/image/hdr'
import { linearInfo, packFloatLinear, readLinearRegion } from '../../app/lib/image/high-depth'
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
