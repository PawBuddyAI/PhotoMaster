import { expect, test } from '@playwright/test'

/**
 * 在真实浏览器中验证 WebGL 调色管线与分块导出。
 * 开发服务器下 app/ 目录可通过 /_nuxt/ 前缀直接动态导入。
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('恒等参数输出等于输入，+1EV 使线性亮度翻倍，区域调整只影响区域内', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PhotoRenderer } = await import('/_nuxt/lib/pipeline/renderer.ts')
    const { defaultAdjustParams } = await import('/_nuxt/lib/adjust/params.ts')
    const { buildRenderLayers } = await import('/_nuxt/lib/pipeline/layers.ts')
    const { createMaskSpec } = await import('/_nuxt/lib/mask/spec.ts')

    const W = 256
    const H = 32
    const source = new OffscreenCanvas(W, H)
    const ctx = source.getContext('2d')!
    const image = ctx.createImageData(W, H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4
        image.data[p] = x
        image.data[p + 1] = (x * 7 + y * 3) % 256
        image.data[p + 2] = 255 - x
        image.data[p + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    const src = image.data

    const renderer = new PhotoRenderer(new OffscreenCanvas(1, 1))
    renderer.setSource(source, W, H)
    const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray, from = 0, to = W) => {
      let m = 0
      for (let y = 0; y < H; y++) {
        for (let x = from; x < to; x++) {
          for (let c = 0; c < 3; c++) {
            const i = (y * W + x) * 4 + c
            m = Math.max(m, Math.abs(a[i]! - b[i]!))
          }
        }
      }
      return m
    }

    renderer.process([], W)
    const identity = maxDiff(renderer.readPixels(W, H), src)

    const toLinear = (v: number) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    const toSrgb = (l: number) => {
      const c = Math.min(1, Math.max(0, l))
      return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255)
    }
    renderer.process([{ params: { ...defaultAdjustParams(), exposure: 1 }, mask: null }], W)
    const brighter = renderer.readPixels(W, H)
    let exposureErr = 0
    for (let i = 0; i < src.length; i += 4) {
      // 曝光在线性空间逐通道乘以 2^EV
      for (let c = 0; c < 3; c++) {
        exposureErr = Math.max(exposureErr, Math.abs(brighter[i + c]! - toSrgb(toLinear(src[i + c]!) * 2)))
      }
    }

    const layers = buildRenderLayers(
      [{ params: { ...defaultAdjustParams(), exposure: -2 }, mask: createMaskSpec('rect', { rect: { x: 0, y: 0, w: 0.5, h: 1 }, feather: 0 }) }],
      W, H, { x: 0, y: 0, w: W, h: H }, W, H, 'test'
    )
    renderer.process(layers, W)
    const masked = renderer.readPixels(W, H)
    const outsideDiff = maxDiff(masked, src, W / 2 + 2, W)
    const insideDiff = maxDiff(masked, src, 8, W / 2 - 2)
    const glError = renderer.gl.getError()
    renderer.dispose()
    return { identity, exposureErr, outsideDiff, insideDiff, glError }
  })

  expect(result.identity).toBeLessThanOrEqual(1)
  expect(result.exposureErr).toBeLessThanOrEqual(2)
  expect(result.outsideDiff).toBeLessThanOrEqual(1)
  expect(result.insideDiff).toBeGreaterThan(20)
  expect(result.glError).toBe(0)
})

test('每个调色参数都能生效且不产生无效像素', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PhotoRenderer } = await import('/_nuxt/lib/pipeline/renderer.ts')
    const { ADJUST_PARAM_DEFS, defaultAdjustParams } = await import('/_nuxt/lib/adjust/params.ts')
    const W = 320
    const H = 200
    const source = new OffscreenCanvas(W, H)
    const ctx = source.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, W, H)
    gradient.addColorStop(0, '#203040')
    gradient.addColorStop(0.5, '#c08040')
    gradient.addColorStop(1, '#f0f0e0')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = i % 2 ? '#101010' : '#fafafa'
      ctx.fillRect(i * 8, 80, 4, 40)
    }
    const src = ctx.getImageData(0, 0, W, H).data
    const renderer = new PhotoRenderer(new OffscreenCanvas(1, 1))
    renderer.setSource(source, W, H)
    const changes: Record<string, number> = {}
    for (const def of ADJUST_PARAM_DEFS) {
      for (const value of [def.max, def.min]) {
        if (value === 0) continue
        renderer.process([{ params: { ...defaultAdjustParams(), [def.key]: value }, mask: null }], W)
        const out = renderer.readPixels(W, H)
        let sum = 0
        for (let i = 0; i < out.length; i += 4) {
          sum += Math.abs(out[i]! - src[i]!) + Math.abs(out[i + 1]! - src[i + 1]!) + Math.abs(out[i + 2]! - src[i + 2]!)
        }
        changes[`${def.key}:${value}`] = sum / (W * H)
      }
    }
    const glError = renderer.gl.getError()
    renderer.dispose()
    return { changes, glError }
  })

  for (const [key, change] of Object.entries(result.changes)) {
    expect(change, key).toBeGreaterThan(0.5)
    expect(Number.isFinite(change), key).toBe(true)
  }
  expect(result.glError).toBe(0)
})

test('分块导出与整块导出结果一致（无接缝），并保持原图分辨率', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderExport } = await import('/_nuxt/lib/image/export.ts')
    const { defaultAdjustParams } = await import('/_nuxt/lib/adjust/params.ts')
    const { createMaskSpec } = await import('/_nuxt/lib/mask/spec.ts')
    const W = 2600
    const H = 1700
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d')!
    for (let y = 0; y < H; y += 20) {
      for (let x = 0; x < W; x += 20) {
        ctx.fillStyle = `hsl(${(x + y) % 360}, 55%, ${30 + ((x * y) % 40)}%)`
        ctx.fillRect(x, y, 20, 20)
      }
    }
    const original = await canvas.convertToBlob({ type: 'image/png' })
    const input = {
      original,
      patches: [],
      layers: [
        { params: { ...defaultAdjustParams(), clarity: 80, sharpen: 60, contrast: 20 }, mask: createMaskSpec('full') },
        { params: { ...defaultAdjustParams(), exposure: -1, temperature: 30 }, mask: createMaskSpec('linear', { line: { x0: 0.5, y0: 0, x1: 0.5, y1: 0.6 } }) }
      ],
      crop: { rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, angle: 3 },
      format: 'image/png' as const,
      quality: 1,
      keepExif: false
    }
    const decode = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob)
      const c = new OffscreenCanvas(bitmap.width, bitmap.height)
      c.getContext('2d')!.drawImage(bitmap, 0, 0)
      return { w: bitmap.width, h: bitmap.height, data: c.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data }
    }
    const tiled = await decode((await renderExport({ ...input, tileSize: 512 })).blob)
    const whole = await decode((await renderExport({ ...input, tileSize: 4096 })).blob)
    let maxDiff = 0
    for (let i = 0; i < tiled.data.length; i++) {
      if (i % 4 === 3) continue
      maxDiff = Math.max(maxDiff, Math.abs(tiled.data[i]! - whole.data[i]!))
    }
    return { size: [tiled.w, tiled.h], wholeSize: [whole.w, whole.h], maxDiff }
  })

  expect(result.size).toEqual([2080, 1360])
  expect(result.wholeSize).toEqual(result.size)
  expect(result.maxDiff).toBeLessThanOrEqual(3)
})
