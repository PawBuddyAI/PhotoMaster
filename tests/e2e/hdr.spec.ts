import { expect, test } from '@playwright/test'
import { extractGainmapFromJPEG } from '@monogrid/gainmap-js'
import { makeDng } from '../fixtures/dng'
import { readExr } from '../fixtures/exr'
import { readPng16 } from '../fixtures/png16'
import { skipSetupWizard } from './helpers'

test.beforeEach(async ({ page }) => {
  await skipSetupWizard(page)

  await page.goto('/')
})

test('HDR 导出界面、SDR 回退与设置重开', async ({ page }, testInfo) => {
  await page.locator('input[type=file]').setInputFiles({ name: 'HDR.dng', mimeType: '', buffer: makeDng() })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: /预览/ })).toBeVisible()
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('switch', { name: '自动使用 HDR 屏幕预览' }).click()
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Ultra HDR JPEG（兼容 SDR）' }).click()
  await expect(page.getByRole('listbox')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('hdr-export-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dialog.getByRole('button', { name: '导出', exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('hdr-export-mobile.png') })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByText('SDR 色调映射预览', { exact: true })).toBeVisible()
  // 等待工程自动保存的 debounce。
  await expect.poll(() => page.evaluate(async () => {
    const { getProject } = await import('/_nuxt/lib/storage/db.ts')
    return (await getProject(location.pathname.split('/').at(-1)!))?.doc.hdr?.preview
  })).toBe('sdr')
  await page.reload()
  await expect(page.getByText('SDR 色调映射预览', { exact: true })).toBeVisible()
})

test('WebGPU HDR 画布实际配置和上传通过验证', async ({ page }) => {
  const result = await page.evaluate(async () => {
    if (!navigator.gpu || !await navigator.gpu.requestAdapter()) return { unavailable: true }
    const { HdrDisplay } = await import('/_nuxt/lib/pipeline/hdr-display.ts')
    const display = await HdrDisplay.create(() => {})
    const config = display.canvas.getContext('webgpu')!.getConfiguration()!
    config.device.pushErrorScope('validation')
    display.present(new Float32Array([0.18, 0.18, 0.18, 1, 4, 4, 4, 1]), 2, 1)
    await config.device.queue.onSubmittedWorkDone()
    const error = await config.device.popErrorScope()
    display.dispose()
    return { unavailable: false, error: error?.message, format: config.format, mode: config.toneMapping?.mode }
  })
  test.skip(result.unavailable, '此测试环境没有 WebGPU adapter；物理 HDR 需目标设备验证')
  expect(result.error).toBeUndefined()
  expect(result.format).toBe('rgba16float')
  expect(result.mode).toBe('extended')
})

test('真实 RAW 数值线性、黑电平和白平衡高光不截断', async ({ page }) => {
  const result = await page.evaluate(async (files) => {
    const { decodeRaw } = await import('/_nuxt/lib/image/raw.ts')
    const { readLinearRegion, linearInfo } = await import('/_nuxt/lib/image/high-depth.ts')
    const results = []
    for (const bytes of files) {
      const decoded = await decodeRaw(new File([new Uint8Array(bytes)], 'test.dng'))
      const image = await readLinearRegion(decoded.linear, { x: 0, y: 0, w: 128, h: 96 }, 128, 96)
      results.push({ hdr: (await linearInfo(decoded.linear)).hdr, middle: image.data[(48 * 128 + 64) * 4], max: Math.max(...image.data), min: Math.min(...image.data) })
    }
    return results
  }, [[...makeDng()], [...makeDng(1, { black: 1000 })], [...makeDng(1, { neutral: [0.25, 1, 0.5], black: 1000 })]])
  expect(result[0]!.hdr).toBe(true)
  expect(result[0]!.middle).toBeCloseTo(30000 / 65535, 3)
  expect(result[1]!.middle).toBeCloseTo(29000 / 64535, 3)
  expect(result[2]!.max).toBeGreaterThan(2)
  expect(result[2]!.min).toBeLessThan(0)
})

test('传感器饱和的高光还原为中性白，不偏粉紫', async ({ page }) => {
  const white = 16383
  const neutral = [0.5, 1, 0.66]
  // 左半边中性灰；右半边比白电平亮 1.5 倍的中性物体：G 先饱和，R / B 乘上白平衡增益后会高于被截住的 G
  const bytes = makeDng(1, {
    neutral,
    white,
    pixel: (x, _y, channel) => Math.min(white, Math.round(white * (x >= 64 ? 1.5 : 0.18) * neutral[channel]!))
  })
  const result = await page.evaluate(async (bytes) => {
    const { decodeRaw } = await import('/_nuxt/lib/image/raw.ts')
    const { readLinearRegion } = await import('/_nuxt/lib/image/high-depth.ts')
    const decoded = await decodeRaw(new File([new Uint8Array(bytes)], 'highlight.dng'))
    const image = await readLinearRegion(decoded.linear, { x: 0, y: 0, w: 128, h: 96 }, 128, 96)
    const linear = (x: number) => Array.from(image.data.slice((48 * 128 + x) * 4, (48 * 128 + x) * 4 + 3))
    const bitmap = await createImageBitmap(decoded.blob)
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return { gray: linear(30), clipped: linear(100), clippedSdr: Array.from(ctx.getImageData(100, 48, 1, 1).data.slice(0, 3)) }
  }, [...bytes])
  for (const v of result.gray) expect(v).toBeCloseTo(0.18, 2)
  // 补到未饱和的最亮通道（约 1.5），保留超过参考白的 HDR 亮度
  for (const v of result.clipped) expect(v).toBeCloseTo(1.5, 1)
  expect(Math.max(...result.clipped) - Math.min(...result.clipped)).toBeLessThan(0.02)
  expect(Math.max(...result.clippedSdr) - Math.min(...result.clippedSdr)).toBeLessThanOrEqual(1)
})

test('HDR 调色、EXR / PQ PNG / Ultra HDR 导出保留高光，SDR 回退有层次', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { packFloatLinear } = await import('/_nuxt/lib/image/high-depth.ts')
    const { renderExport } = await import('/_nuxt/lib/image/export.ts')
    const { PhotoRenderer } = await import('/_nuxt/lib/pipeline/renderer.ts')
    const { defaultAdjustParams } = await import('/_nuxt/lib/adjust/params.ts')
    const width = 128
    const linear = packFloatLinear(width, 16, (p) => {
      const v = 0.1 + (p % width) / (width - 1) * 7.9

      return [v, v, v]
    })
    const input = { original: new Blob(), linear, patches: [], layers: [], crop: null, quality: 1, keepExif: false, tileSize: 64 }
    const blobs = []
    for (const format of ['image/x-exr', 'image/png-hdr', 'image/ultrahdr', 'image/png'] as const) blobs.push([...new Uint8Array(await (await renderExport({ ...input, format })).blob.arrayBuffer())])
    const gpu = new PhotoRenderer(new OffscreenCanvas(1, 1), true, true)
    gpu.setLinearSource(new Float32Array([2, 2, 2, 1, 4, 4, 4, 1]), 2, 1)
    gpu.process([{ params: { ...defaultAdjustParams(), highlights: -100 }, mask: null }], 2)
    const lowered = [...gpu.readLinearPixels()]
    gpu.process([{ params: { ...defaultAdjustParams(), exposure: 2 }, mask: null }, { params: { ...defaultAdjustParams(), exposure: -2 }, mask: null }], 2)
    const restored = [...gpu.readLinearPixels()]
    gpu.dispose()
    return { blobs, lowered, restored }
  })
  expect(result.lowered[0]).toBeLessThan(2)
  expect(result.lowered[4]).toBeLessThan(4)
  expect(result.restored[0]).toBeCloseTo(2, 4)
  expect(result.restored[4]).toBeCloseTo(4, 4)
  const exr = readExr(new Uint8Array(result.blobs[0]!))
  expect(exr.rgb[127 * 3]).toBeCloseTo(8, 4)
  const pq = readPng16(new Uint8Array(result.blobs[1]!), true)
  const sdr = readPng16(new Uint8Array(result.blobs[3]!))
  expect(pq.pixels[127 * 3]).toBeGreaterThan(pq.pixels[64 * 3]!)
  expect(sdr.pixels[64 * 3]).toBeGreaterThan(sdr.pixels[32 * 3]!)
  const extracted = await extractGainmapFromJPEG(new Uint8Array(result.blobs[2]!))
  expect(extracted.metadata.hdrCapacityMax).toBeCloseTo(Math.log2(1000 / 203), 4)
  const recovery = await page.evaluate(async ({ sdr, gainMap, metadata }) => {
    const sample = async (bytes: number[]) => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
      const canvas = new OffscreenCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      image.close()
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const low = await sample(sdr)
    const map = await sample(gainMap)
    return [16, 64, 120].map((x) => {
      const c = low[x * 4]! / 255
      const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      const gain = map[x * 4]! / 255 * (metadata.gainMapMax[0] - metadata.gainMapMin[0]) + metadata.gainMapMin[0]
      return (linear + metadata.offsetSdr[0]) * 2 ** gain - metadata.offsetHdr[0]
    })
  }, { sdr: [...extracted.sdr], gainMap: [...extracted.gainMap], metadata: extracted.metadata })
  expect(recovery[1]).toBeGreaterThan(2)
  expect(recovery[2]).toBeGreaterThan(recovery[1]!)
  expect(recovery[2]).toBeLessThan(5)
})
