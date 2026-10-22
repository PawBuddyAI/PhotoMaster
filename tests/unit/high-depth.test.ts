import { expect, it } from 'vitest'
import { linearSize, packRawLinear, readLinearRegion } from '~/lib/image/high-depth'
import { encodePng16 } from '~/lib/image/png16'
import { readPng16 } from '../fixtures/png16'
import { rasterizeMask, rasterizeMaskFloat } from '~/lib/mask/rasterize'
import { createMaskSpec } from '~/lib/mask/spec'

it('RAW 渐变蒙版保留浮点覆盖率，旧图像仍使用 8 位蒙版', () => {
  const spec = createMaskSpec('linear', { line: { x0: 0, y0: 0, x1: 1, y1: 0 } })
  const region = { x: 0, y: 0, w: 2048, h: 1 }
  const floats = rasterizeMaskFloat(spec, 2048, 1, region, 2048, 1)
  expect(new Set(floats).size).toBeGreaterThan(2000)
  expect(new Set(rasterizeMask(spec, 2048, 1, region, 2048, 1)).size).toBeLessThanOrEqual(256)
})

it('16 位底图保留低字节、通道次序与方向，按区域读取不经过 8 位量化', async () => {
  const data = new Uint16Array([1, 257, 65535, 32768, 32769, 32770, 0, 100, 1000, 1024, 1025, 1026])
  const blob = packRawLinear({ data, width: 2, height: 2, colors: 3, bits: 16, dataSize: data.byteLength })
  expect(await linearSize(blob)).toEqual({ width: 2, height: 2 })
  const region = await readLinearRegion(blob, { x: 1, y: 0, w: 1, h: 2 }, 1, 2)
  expect([...region.data].filter((_, i) => i % 4 !== 3).map(v => Math.round(v * 65535))).toEqual([32768, 32769, 32770, 1024, 1025, 1026])
  const preview = await readLinearRegion(blob, { x: 0, y: 0, w: 2, h: 2 }, 1, 1)
  expect(preview.data[0]).toBeCloseTo((1 + 32768 + 0 + 1024) / (4 * 65535), 7)
  await expect(linearSize(blob.slice(0, -1))).rejects.toThrow('不完整')
})

it('拒绝伪 16 位数据，单色复制为 RGB，四通道不误作 alpha', async () => {
  expect(() => packRawLinear({ data: new Uint8Array(3), width: 1, height: 1, bits: 16, colors: 3, dataSize: 3 })).toThrow('不完整')
  for (const colors of [1, 4]) {
    const data = new Uint16Array(colors).fill(12345)
    const blob = packRawLinear({ data, width: 1, height: 1, bits: 16, colors, dataSize: data.byteLength })
    const image = await readLinearRegion(blob, { x: 0, y: 0, w: 1, h: 1 }, 1, 1)
    expect([...image.data].slice(0, 3).map(v => Math.round(v * 65535))).toEqual([12345, 12345, 12345])
  }
})

it('PNG16 实际样本、CRC、sRGB 标记和多条带顺序正确，超过 256 级', async () => {
  const pixels = Uint16Array.from({ length: 1024 * 2 * 3 }, (_, i) => (i * 17 + 123) % 65536)
  async function* bands() {
    yield pixels.subarray(0, 1024 * 3)
    yield pixels.subarray(1024 * 3)
  }
  const blob = await encodePng16(1024, 2, bands())
  const decoded = readPng16(new Uint8Array(await blob.arrayBuffer()))
  expect(decoded.width).toBe(1024)
  expect(decoded.height).toBe(2)
  expect(decoded.pixels).toEqual(pixels)
  expect(new Set(decoded.pixels).size).toBeGreaterThan(256)
})

it('PNG16 输入失败或缺行时拒绝，压缩流不会挂起', async () => {
  async function* missing() {
    yield new Uint16Array(3)
  }
  await expect(encodePng16(1, 2, missing())).rejects.toThrow('数量不匹配')
  async function* failed() {
    yield new Uint16Array(3)
    throw new Error('render failed')
  }
  await expect(encodePng16(1, 2, failed())).rejects.toThrow('render failed')
})
