import { expect, test } from '@playwright/test'
import { readPng16 } from '../fixtures/png16'
import { skipSetupWizard } from './helpers'

test.beforeEach(async ({ page }) => {
  await skipSetupWizard(page)
  await page.goto('/')
})

test('RAW 调色保留相邻 16 位样本，曝光可逆，透明补丁不降精度，PNG 分块导出真实 16 位', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PhotoRenderer } = await import('/_nuxt/lib/pipeline/renderer.ts')
    const { packRawLinear, readLinearRegion, composeLinear, linearToSrgb } = await import('/_nuxt/lib/image/high-depth.ts')
    const { renderExport } = await import('/_nuxt/lib/image/export.ts')
    const { defaultAdjustParams } = await import('/_nuxt/lib/adjust/params.ts')
    const width = 1024
    const height = 4
    // 中灰附近相邻 16 位样本；RGBA16F / 8 位源都会丢掉其中多数差异。
    const data = Uint16Array.from({ length: width * height * 3 }, (_, i) => 30000 + Math.floor(i / 3) % width)
    const linear = packRawLinear({ data, width, height, colors: 3, bits: 16, dataSize: data.byteLength })
    const region = { x: 0, y: 0, w: width, h: height }
    const image = await readLinearRegion(linear, region, width, height)
    const patch = new OffscreenCanvas(width, height)
    const ctx = patch.getContext('2d')!
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 1, height)
    const base = composeLinear(image, [{ image: patch, x: 0, y: 0, w: width, h: height }], region)
    const outsideUnchanged = image.data.subarray(4).every((value, i) => (i + 4) % (width * 4) < 4 || value === base.data[i + 4])
    const renderer = new PhotoRenderer(new OffscreenCanvas(1, 1), true)
    renderer.setLinearSource(image.data, width, height)
    const identity = renderer.readPixels16(width, height)
    renderer.process([
      { params: { ...defaultAdjustParams(), exposure: 2 }, mask: null },
      { params: { ...defaultAdjustParams(), exposure: -2 }, mask: null }
    ], width)
    const adjusted = renderer.readPixels16(width, height)
    const error = Math.max(...adjusted.map((v, i) => Math.abs(v - identity[i]!)))
    const expected = data.map(v => Math.round(linearToSrgb(v / 65535) * 65535))
    const identityError = Math.max(...identity.map((v, i) => Math.abs(v - expected[i]!)))
    const glError = renderer.gl.getError()
    renderer.dispose()
    // 原图故意不可解码：证明导出真正使用线性底图，没有退回 PNG 显示副本。
    const input = { original: new Blob(['not a PNG']), linear, patches: [], layers: [], crop: null, format: 'image/png' as const, quality: 1, keepExif: false }
    const tiled = await renderExport({ ...input, tileSize: 128 })
    const single = await renderExport({ ...input, tileSize: 2048 })
    return { error, identityError, glError, outsideUnchanged, red: [...base.data.subarray(0, 4)], levels: new Set(identity).size, tiled: [...new Uint8Array(await tiled.blob.arrayBuffer())], single: [...new Uint8Array(await single.blob.arrayBuffer())] }
  })
  expect(result.error).toBeLessThanOrEqual(2)
  expect(result.identityError).toBeLessThanOrEqual(1)
  expect(result.glError).toBe(0)
  expect(result.outsideUnchanged).toBe(true)
  expect(result.red).toEqual([1, 0, 0, 1])
  expect(result.levels).toBeGreaterThan(500)
  const tiled = readPng16(new Uint8Array(result.tiled))
  const single = readPng16(new Uint8Array(result.single))
  expect(tiled.pixels).toEqual(single.pixels)
  expect(new Set(tiled.pixels).size).toBeGreaterThan(500)
})

test('不支持浮点的设备明确拒绝 RAW，不静默退回 8 位', async ({ page }) => {
  const error = await page.evaluate(async () => {
    const { PhotoRenderer } = await import('/_nuxt/lib/pipeline/renderer.ts')
    const canvas = new OffscreenCanvas(1, 1)
    const gl = canvas.getContext('webgl2')!
    gl.getExtension = () => null
    try {
      new PhotoRenderer(canvas, true)
      return ''
    } catch (error) {
      return String(error)
    }
  })
  expect(error).toContain('不支持 RAW 高精度')
})

test('RAW 渐变蒙版经过 GPU 后仍超过 256 级', async ({ page }) => {
  const levels = await page.evaluate(async () => {
    const { PhotoRenderer } = await import('/_nuxt/lib/pipeline/renderer.ts')
    const { defaultAdjustParams } = await import('/_nuxt/lib/adjust/params.ts')
    const { rasterizeMaskFloat } = await import('/_nuxt/lib/mask/rasterize.ts')
    const { createMaskSpec } = await import('/_nuxt/lib/mask/spec.ts')
    const data = new Float32Array(2048 * 4).fill(0.3)
    const spec = createMaskSpec('linear', { line: { x0: 0, y0: 0, x1: 1, y1: 0 } })
    const mask = rasterizeMaskFloat(spec, 2048, 1, { x: 0, y: 0, w: 2048, h: 1 }, 2048, 1)
    const renderer = new PhotoRenderer(new OffscreenCanvas(1, 1), true)
    renderer.setLinearSource(data, 2048, 1)
    renderer.process([{ params: { ...defaultAdjustParams(), exposure: 1 }, mask: { data: mask, width: 2048, height: 1, key: 'gradient', empty: false } }], 2048)
    const levels = new Set(renderer.readPixels16(2048, 1)).size
    renderer.dispose()
    return levels
  })
  expect(levels).toBeGreaterThan(1500)
})

test('高位深蒙版、生成补丁、旋转裁剪导出与整块一致，JPEG/WebP 仅在输出时降为 8 位', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { packRawLinear } = await import('/_nuxt/lib/image/high-depth.ts')
    const { renderExport } = await import('/_nuxt/lib/image/export.ts')
    const { defaultAdjustParams } = await import('/_nuxt/lib/adjust/params.ts')
    const { createMaskSpec } = await import('/_nuxt/lib/mask/spec.ts')
    const width = 400
    const height = 300
    const data = Uint16Array.from({ length: width * height * 3 }, (_, i) => 2000 + Math.floor(i / 3) % width * 100 + Math.floor(i / 3 / width) * 10)
    const linear = packRawLinear({ data, width, height, colors: 3, bits: 16, dataSize: data.byteLength })
    const patch = new OffscreenCanvas(40, 40)
    const ctx = patch.getContext('2d')!
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'
    ctx.fillRect(0, 0, 40, 40)
    const input = {
      original: new Blob(['unused']), linear,
      patches: [{ blob: await patch.convertToBlob(), x: 100, y: 100, w: 40, h: 40 }],
      layers: [
        { params: { ...defaultAdjustParams(), exposure: 0.5 }, mask: createMaskSpec('linear', { line: { x0: 0.1, y0: 0, x1: 0.9, y1: 1 } }) }
      ],
      crop: { rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, angle: 3 },
      format: 'image/png' as const, quality: 1, keepExif: false
    }
    const tiled = await renderExport({ ...input, tileSize: 128 })
    const whole = await renderExport({ ...input, tileSize: 2048 })
    const outputs = []
    for (const format of ['image/jpeg', 'image/webp'] as const) {
      const output = await renderExport({ ...input, format, tileSize: 128 })
      const bitmap = await createImageBitmap(output.blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
      outputs.push({ type: output.blob.type, size: [bitmap.width, bitmap.height], range: Math.max(...pixels.filter((_, i) => i % 4 === 0)) - Math.min(...pixels.filter((_, i) => i % 4 === 0)) })
      bitmap.close()
    }
    return { tiled: [...new Uint8Array(await tiled.blob.arrayBuffer())], whole: [...new Uint8Array(await whole.blob.arrayBuffer())], outputs }
  })
  const tiled = readPng16(new Uint8Array(result.tiled))
  const whole = readPng16(new Uint8Array(result.whole))
  expect([tiled.width, tiled.height]).toEqual([320, 240])
  let maxDiff = 0
  for (let i = 0; i < tiled.pixels.length; i++) maxDiff = Math.max(maxDiff, Math.abs(tiled.pixels[i]! - whole.pixels[i]!))
  expect(maxDiff).toBeLessThanOrEqual(2)
  expect(result.outputs.map(o => o.type)).toEqual(['image/jpeg', 'image/webp'])
  for (const output of result.outputs) {
    expect(output.size).toEqual([320, 240])
    expect(output.range).toBeGreaterThan(80)
  }
})
