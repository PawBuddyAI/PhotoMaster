import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { extractGainmapFromJPEG } from '@monogrid/gainmap-js'
import piexif from 'piexifjs'
import { fixVignetteRadial, gainMap, makeDng, opcodeList, warpRectilinear } from '../fixtures/dng'
import { pngChunks, readPng16 } from '../fixtures/png16'
import { skipSetupWizard } from './helpers'

test.beforeEach(({ page }) => skipSetupWizard(page))

/** 在页面里真实解码一组 DNG，返回各自的尺寸、校正记录与若干位置的线性 sRGB 值 */
async function decodeAll(page: Page, files: Record<string, Buffer>, points: Array<[number, number]>) {
  return page.evaluate(async ({ files, points }) => {
    const { decodeRaw } = await import('/_nuxt/lib/image/raw.ts')
    const { readLinearRegion, linearInfo } = await import('/_nuxt/lib/image/high-depth.ts')
    const out: Record<string, { width: number, height: number, corrections: string[], values: number[][] }> = {}
    for (const [name, bytes] of Object.entries(files)) {
      const decoded = await decodeRaw(new File([new Uint8Array(bytes)], `${name}.dng`))
      const { width, height } = await linearInfo(decoded.linear)
      const image = await readLinearRegion(decoded.linear, { x: 0, y: 0, w: width, h: height }, width, height)
      out[name] = {
        width, height, corrections: decoded.corrections,
        values: points.map(([x, y]) => x < width && y < height ? Array.from(image.data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)) : [])
      }
    }
    return out
  }, { files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [...v]])), points })
}

test('DNG 镜头校正：增益图、暗角、畸变与 DefaultCrop 在解码时施加', async ({ page }) => {
  await page.goto('/')
  const flat = () => 20000
  const area = { top: 0, left: 0, bottom: 96, right: 128 }
  const result = await decodeAll(page, {
    base: makeDng(1, { pixel: flat }),
    // 作用于全部像素的增益图：输出整体翻倍
    allGain: makeDng(1, { pixel: flat, raw: { 51009: opcodeList([{ id: 9, params: gainMap(area, { points: [1, 1], gains: [2] }) }]) } }),
    // 只作用于 R 相位的增益图，应等同于传感器上 R 样本本身翻倍
    redGain: makeDng(1, { pixel: flat, raw: { 51009: opcodeList([{ id: 9, params: gainMap(area, { pitch: 2, points: [1, 1], gains: [2] }) }]) } }),
    redRaw: makeDng(1, { pixel: (_x, _y, c) => c === 0 ? 40000 : 20000 }),
    vignette: makeDng(1, { pixel: flat, raw: { 51022: opcodeList([{ id: 3, params: fixVignetteRadial([1]) }]) } }),
    ramp: makeDng(1, { pixel: x => 2000 + 400 * x }),
    warp: makeDng(1, { pixel: x => 2000 + 400 * x, raw: { 51022: opcodeList([{ id: 1, params: warpRectilinear([[0.5, 0, 0, 0, 0, 0]]) }]) } }),
    gradient: makeDng(1),
    cropped: makeDng(1, { raw: { 50719: { type: 4, values: [8, 4] }, 50720: { type: 4, values: [112, 88] } } }),
    rotated: makeDng(6, { raw: { 50719: { type: 4, values: [8, 4] }, 50720: { type: 4, values: [112, 88] } } })
  }, [[64, 48], [0, 0], [100, 48], [81, 48], [82, 48], [20, 10], [28, 14]])
  const center = 0
  const corner = 1
  for (let c = 0; c < 3; c++) {
    expect(result.allGain!.values[center]![c]! / result.base!.values[center]![c]!).toBeCloseTo(2, 3)
    expect(result.redGain!.values[center]![c]!).toBeCloseTo(result.redRaw!.values[center]![c]!, 3)
    expect(result.vignette!.values[center]![c]! / result.base!.values[center]![c]!).toBeCloseTo(1 + (0.5 ** 2 + 0.5 ** 2) / 6400, 3)
    // 左上角像素中心 (0.5, 0.5)：到中心的距离²除以到最远角的距离² 80²
    expect(result.vignette!.values[corner]![c]! / result.base!.values[corner]![c]!).toBeCloseTo(1 + (63.5 ** 2 + 47.5 ** 2) / 6400, 2)
    // kr0 = 0.5：第 100 列的中心 100.5 取样自 64 + 0.5 × (100.5 − 64) = 82.25，即第 81.75 列（81、82 两列之间）
    const expected = result.ramp!.values[3]![c]! * 0.25 + result.ramp!.values[4]![c]! * 0.75
    expect(result.warp!.values[2]![c]! / expected).toBeCloseTo(1, 2)
    // DefaultCrop：输出 (20, 10) 是原来的 (28, 14)
    expect(result.cropped!.values[5]![c]!).toBeCloseTo(result.gradient!.values[6]![c]!, 4)
  }
  expect(result.base).toMatchObject({ width: 128, height: 96, corrections: [] })
  expect(result.allGain!.corrections).toEqual(['GainMap'])
  expect(result.vignette!.corrections).toEqual(['FixVignetteRadial'])
  expect(result.warp!.corrections).toEqual(['WarpRectilinear'])
  expect(result.cropped).toMatchObject({ width: 112, height: 88, corrections: ['DefaultCrop'] })
  expect(result.rotated).toMatchObject({ width: 88, height: 112 })
})

/** 导出并取得下载的文件内容 */
async function exportAs(page: Page, option: string): Promise<Buffer> {
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await expect(dialog.getByRole('switch', { name: '保留 EXIF 信息' })).toBeChecked()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  const file = await readFile((await (await download).path())!)
  await expect(dialog).toBeHidden()
  return file
}

test('RAW 导出带上原件的拍摄时间、GPS、机型与镜头（JPEG、Ultra HDR、16 位 PNG）', async ({ page }) => {
  test.setTimeout(240_000)
  const dng = makeDng(6, {
    ifd0: { 306: { type: 2, values: '2024:05:06 07:08:09' }, 315: { type: 2, values: '测试者' } },
    exif: {
      33434: { type: 5, values: [1 / 250] },
      33437: { type: 5, values: [2.8] },
      34855: { type: 3, values: [3200] },
      36867: { type: 2, values: '2024:05:06 07:08:09' },
      37386: { type: 5, values: [35] },
      41989: { type: 3, values: [52] },
      42035: { type: 2, values: 'LensCo' },
      42036: { type: 2, values: 'LensCo 35mm F2.8' }
    },
    gps: {
      0: { type: 1, values: [2, 3, 0, 0] },
      1: { type: 2, values: 'N' },
      2: { type: 5, values: [31, 14, 15.5] },
      3: { type: 2, values: 'E' },
      4: { type: 5, values: [121, 28, 30.25] },
      5: { type: 1, values: [0] },
      6: { type: 5, values: [12.5] }
    }
  })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'exif.dng', mimeType: '', buffer: dng })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()
  const check = (exif: ReturnType<typeof piexif.load>, width: number, height: number) => {
    expect(exif['0th']![piexif.ImageIFD.Make]).toBe('PhotoMaster')
    expect(exif['0th']![piexif.ImageIFD.Model]).toBe('Synthetic DNG')
    expect(exif['0th']![piexif.ImageIFD.Orientation]).toBe(1)
    expect(exif.Exif![piexif.ExifIFD.DateTimeOriginal]).toBe('2024:05:06 07:08:09')
    expect(exif.Exif![piexif.ExifIFD.ExposureTime]).toEqual([1, 250])
    expect(exif.Exif![piexif.ExifIFD.ISOSpeedRatings]).toBe(3200)
    expect(exif.Exif![piexif.ExifIFD.LensModel]).toBe('LensCo 35mm F2.8')
    expect(exif.Exif![piexif.ExifIFD.PixelXDimension]).toBe(width)
    expect(exif.Exif![piexif.ExifIFD.PixelYDimension]).toBe(height)
    expect(exif.GPS![piexif.GPSIFD.GPSLatitudeRef]).toBe('N')
    expect(piexif.GPSHelper.dmsRationalToDeg(exif.GPS![piexif.GPSIFD.GPSLongitude], 'E')).toBeCloseTo(121 + 28 / 60 + 30.25 / 3600, 5)
  }
  const jpeg = await exportAs(page, 'JPEG')
  check(piexif.load(jpeg.toString('binary')), 96, 128)
  const ultra = await exportAs(page, 'Ultra HDR JPEG（兼容 SDR）')
  check(piexif.load(ultra.toString('binary')), 96, 128)
  // EXIF 插在基础 JPEG 之后，增益图仍能按 MPF 偏移取出
  const extracted = await extractGainmapFromJPEG(new Uint8Array(ultra))
  expect(extracted.gainMap.length).toBeGreaterThan(0)
  const png = await exportAs(page, 'PNG（16 位，无损）')
  expect(readPng16(png).width).toBe(96)
  const chunks = pngChunks(png)
  const exifIndex = chunks.findIndex(chunk => chunk.name === 'eXIf')
  expect(exifIndex).toBeGreaterThan(0)
  expect(exifIndex).toBeLessThan(chunks.findIndex(chunk => chunk.name === 'IDAT'))
  check(piexif.load(`Exif\0\0${chunks[exifIndex]!.data.toString('binary')}`), 96, 128)
})

/** 可复现的高斯噪声 */
function gaussian(seed: number) {
  let state = seed
  const uniform = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return (state + 0.5) / 2147483648
  }
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform())
}

test('降噪：平坦区的噪点明显减少、明暗交界保留；分块导出与整幅一致', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  const random = gaussian(7)
  // 左半暗、右半亮的两块平坦区，叠加传感器噪声
  const dng = makeDng(1, { width: 192, height: 128, pixel: x => Math.max(0, (x < 96 ? 6000 : 18000) + 900 * random()) })
  const result = await page.evaluate(async (bytes) => {
    const { decodeRaw } = await import('/_nuxt/lib/image/raw.ts')
    const { readLinearRegion } = await import('/_nuxt/lib/image/high-depth.ts')
    const { noiseThresholds } = await import('/_nuxt/lib/image/raw-noise.ts')
    const { PhotoRenderer } = await import('/_nuxt/lib/pipeline/renderer.ts')
    const { renderExport } = await import('/_nuxt/lib/image/export.ts')
    const decoded = await decodeRaw(new File([new Uint8Array(bytes)], 'noisy.dng'))
    const image = await readLinearRegion(decoded.linear, { x: 0, y: 0, w: 192, h: 128 }, 192, 128)
    const gpu = new PhotoRenderer(new OffscreenCanvas(1, 1), true, true)
    gpu.setLinearSource(image.data, 192, 128)
    const render = () => {
      gpu.process([], 192)
      return gpu.readLinearPixels()
    }
    const before = render()
    gpu.setNoiseReduction(noiseThresholds(decoded.profile.noise, 80, 80, 1))
    const after = render()
    gpu.setNoiseReduction(null)
    const restored = render()
    gpu.dispose()
    // 平坦区（避开边缘与交界）的绿色通道标准差与两区均值
    const stats = (pixels: Float32Array, x0: number, x1: number) => {
      const values: number[] = []
      for (let y = 20; y < 108; y++) for (let x = x0; x < x1; x++) values.push(pixels[(y * 192 + x) * 4 + 1]!)
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      return { mean, std: Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) }
    }
    const input = { original: new Blob(), linear: decoded.linear, patches: [], layers: [], crop: null, format: 'image/png' as const, quality: 1, keepExif: false, noise: { profile: decoded.profile.noise, luminance: 80, color: 80 } }
    const tiled = await renderExport({ ...input, tileSize: 64 })
    const whole = await renderExport({ ...input, tileSize: 1024 })
    return {
      before: [stats(before, 20, 80), stats(before, 112, 172)],
      after: [stats(after, 20, 80), stats(after, 112, 172)],
      restored: Array.from(restored.slice(0, 64)), original: Array.from(before.slice(0, 64)),
      tiled: [...new Uint8Array(await tiled.blob.arrayBuffer())], whole: [...new Uint8Array(await whole.blob.arrayBuffer())]
    }
  }, [...dng])
  for (const side of [0, 1]) {
    expect(result.after[side]!.std).toBeLessThan(result.before[side]!.std * 0.6)
    expect(result.after[side]!.mean).toBeCloseTo(result.before[side]!.mean, 2)
  }
  // 交界两侧的亮度差基本不变
  const contrast = (s: typeof result.before) => s[1]!.mean - s[0]!.mean
  expect(contrast(result.after) / contrast(result.before)).toBeGreaterThan(0.97)
  // 关闭降噪后回到原样
  result.restored.forEach((v, i) => expect(v).toBeCloseTo(result.original[i]!, 6))
  // 分块边距覆盖降噪范围：64 像素分块与整幅渲染逐样本一致
  const tiled = readPng16(new Uint8Array(result.tiled)).pixels
  const whole = readPng16(new Uint8Array(result.whole)).pixels
  let diff = 0
  for (let i = 0; i < whole.length; i++) diff = Math.max(diff, Math.abs(tiled[i]! - whole[i]!))
  expect(diff).toBeLessThanOrEqual(1)
})

/** 去掉工程里的 RAW 基础设置与分析结果，模拟升级前导入的旧工程 */
async function makeLegacy(page: Page, id: string): Promise<void> {
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('ai-photo-master')
      request.onsuccess = () => resolve(request.result)
    })
    const update = (store: string, change: (value: Record<string, unknown>) => void) => new Promise<void>((resolve) => {
      const tx = db.transaction(store, 'readwrite')
      const objects = tx.objectStore(store)
      const request = objects.get(id)
      request.onsuccess = () => {
        change(request.result)
        objects.put(request.result)
      }
      tx.oncomplete = () => resolve()
    })
    await update('projects', (record) => {
      delete (record.rawSource as Record<string, unknown>).profile
      delete (record.rawSource as Record<string, unknown>).corrections
    })
    await update('docs', (record) => {
      delete (record.doc as Record<string, unknown>).raw
    })
    db.close()
  }, id)
}

test('RAW 基础：图层列表底部固定一项，切换风格改变画面并可撤销；旧工程打开时补算分析结果', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'base.dng', mimeType: '', buffer: makeDng() })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()
  const id = page.url().split('/').at(-1)!
  const brightness = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!
    const { data } = canvas.getContext('2d')!.getImageData(Math.round(canvas.width / 2) - 20, Math.round(canvas.height / 2) - 20, 40, 40)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!
    return sum / (data.length / 4) / 3
  })
  const stored = () => page.evaluate(async (id) => {
    const { getProject } = await import('/_nuxt/lib/storage/db.ts')
    const project = (await getProject(id))!
    return { raw: project.doc.raw, profile: !!project.rawSource?.profile }
  }, id)
  await page.getByRole('tab', { name: /图层/ }).click()
  const base = page.getByRole('button', { name: /RAW 基础/ })
  // 没有内嵌预览：默认标准风格，颜色降噪 25
  await expect(base).toContainText('标准 · 降噪')
  await base.click()
  const styles = page.getByRole('radiogroup', { name: '风格' })
  await expect(styles.getByRole('radio', { name: /相机直出/ })).toBeDisabled()
  await expect(styles.getByRole('radio', { name: /标准/ })).toBeChecked()
  await expect(page.getByText('这张照片没有可参考的相机预览')).toBeVisible()
  const standard = await brightness()
  await styles.getByRole('radio', { name: /不加处理/ }).click()
  await expect.poll(brightness).toBeLessThan(standard - 5)
  await expect.poll(async () => (await stored()).raw?.look).toBe('none')
  await expect(base).toContainText('不加处理 · 降噪')
  await page.keyboard.press('Control+z')
  await expect(styles.getByRole('radio', { name: /标准/ })).toBeChecked()
  await expect.poll(brightness).toBeCloseTo(standard, 0)
  const luminance = page.getByRole('slider').first()
  await luminance.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await stored()).raw?.noise.luminance).toBe(2)
  await page.screenshot({ path: testInfo.outputPath('raw-base-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('raw-base-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })

  // 旧工程：没有 RAW 基础设置时按不加处理显示；打开面板时从原件补算分析结果，之后可以选风格
  await makeLegacy(page, id)
  await page.reload()
  await expect(page.getByText('正在加载图像')).toBeHidden()
  await page.getByRole('tab', { name: /图层/ }).click()
  await expect(base).toContainText('不加处理')
  expect((await stored()).raw).toBeUndefined()
  const legacy = await brightness()
  await base.click()
  await expect.poll(async () => (await stored()).profile).toBe(true)
  // 只补算分析结果，不改文档、不改外观
  expect((await stored()).raw).toBeUndefined()
  expect(Math.abs(await brightness() - legacy)).toBeLessThan(1)
  await styles.getByRole('radio', { name: /标准/ }).click()
  await expect.poll(async () => (await stored()).raw?.look).toBe('standard')
  await expect.poll(brightness).toBeGreaterThan(legacy + 5)
})

/**
 * 打散的块状场景（每 8×8 一块，亮度从 2^-8 到 2^-0.5），模拟真实照片的亮度分布；带一点颜色。
 * 夹具的色彩矩阵是单位阵（相机空间即 XYZ），转到 sRGB 会放大饱和度，所以相机空间的偏色取得很轻
 */
function sceneDng(preview?: { jpeg: Buffer, width: number, height: number }): Buffer {
  const width = 256
  const height = 192
  const blocks = (width / 8) * (height / 8)
  return makeDng(1, {
    width, height, preview,
    pixel: (x, y, c) => {
      const block = Math.floor(y / 8) * (width / 8) + Math.floor(x / 8)
      const luminance = 2 ** (-8 + 7.5 * ((block * 389) % blocks) / blocks)
      return Math.round(60000 * luminance * (block % 3 === 0 ? [1.04, 1, 0.96][c]! : block % 3 === 1 ? [0.98, 1, 1.03][c]! : 1))
    }
  })
}

test('相机直出：按内嵌预览拟合风格，GPU 出口与预览、与 CPU 计算一致；没有预览时用标准风格', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  // 第一步：解出场景，按一条已知的「相机曲线」生成预览 JPEG
  const preview = await page.evaluate(async (bytes) => {
    const { decodeRaw } = await import('/_nuxt/lib/image/raw.ts')
    const { readLinearRegion, linearToSrgb } = await import('/_nuxt/lib/image/high-depth.ts')
    const decoded = await decodeRaw(new File([new Uint8Array(bytes)], 'scene.dng'))
    const image = await readLinearRegion(decoded.linear, { x: 0, y: 0, w: 256, h: 192 }, 256, 192)
    const pixels = new Uint8ClampedArray(256 * 192 * 4)
    for (let p = 0; p < 256 * 192; p++) {
      const rgb = [image.data[p * 4]!, image.data[p * 4 + 1]!, image.data[p * 4 + 2]!]
      const y = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
      const x = (y * 1.8) ** 1.5
      const target = Math.min(1, x * (1 + 0.3 ** 1.5) / (x + 0.3 ** 1.5))
      for (let c = 0; c < 3; c++) pixels[p * 4 + c] = Math.round(linearToSrgb(Math.min(1, rgb[c]! * target / y)) * 255)
      pixels[p * 4 + 3] = 255
    }
    const canvas = new OffscreenCanvas(256, 192)
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, 256, 192), 0, 0)
    return {
      jpeg: [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })).arrayBuffer())],
      target: Array.from(pixels),
      standard: decoded.profile.camera === null
    }
  }, [...sceneDng()])
  expect(preview.standard).toBe(true)
  // 第二步：带预览的同一张 RAW，拟合后的风格经 GPU 出口应接近预览
  const result = await page.evaluate(async (bytes) => {
    const { decodeRaw } = await import('/_nuxt/lib/image/raw.ts')
    const { readLinearRegion } = await import('/_nuxt/lib/image/high-depth.ts')
    const { renderSdr } = await import('/_nuxt/lib/image/raw-look.ts')
    const { PhotoRenderer } = await import('/_nuxt/lib/pipeline/renderer.ts')
    const decoded = await decodeRaw(new File([new Uint8Array(bytes)], 'camera.dng'))
    const look = decoded.profile.camera!
    const image = await readLinearRegion(decoded.linear, { x: 0, y: 0, w: 256, h: 192 }, 256, 192)
    const gpu = new PhotoRenderer(new OffscreenCanvas(1, 1), true, true)
    gpu.setLinearSource(image.data, 256, 192)
    gpu.setLook(look)
    gpu.process([], 256)
    const rendered = gpu.readPixels(256, 192)
    gpu.dispose()
    const cpu = renderSdr(image, look)
    let gpuVsCpu = 0
    for (let i = 0; i < rendered.length; i++) if (i % 4 !== 3) gpuVsCpu = Math.max(gpuVsCpu, Math.abs(rendered[i]! - cpu[i]!))
    return { look: !!look, chroma: look.chroma, rendered: Array.from(rendered), gpuVsCpu }
  }, [...sceneDng({ jpeg: Buffer.from(preview.jpeg), width: 256, height: 192 })])
  expect(result.look).toBe(true)
  expect(result.gpuVsCpu).toBeLessThanOrEqual(2)
  // 与压缩前的「相机曲线」结果逐像素比较：拟合只看到 JPEG（8×8 块边界与色度下采样有误差），
  // 整体没有明暗偏差，平均误差在 3 级以内
  let total = 0
  let signed = 0
  let count = 0
  for (let i = 0; i < preview.target.length; i++) {
    if (i % 4 === 3) continue
    total += Math.abs(preview.target[i]! - result.rendered[i]!)
    signed += result.rendered[i]! - preview.target[i]!
    count++
  }
  expect(total / count).toBeLessThan(3)
  expect(Math.abs(signed / count)).toBeLessThan(1)
  // 预览没有额外提高饱和度：中间调的色度倍数不明显偏离 1。场景接近中性色，JPEG 量化噪声会让预览色度略高，
  // 色度还原的精确核对在单元测试里用无压缩数据做
  for (const k of [3, 4, 5, 6, 7]) {
    expect(result.chroma[k]).toBeGreaterThan(0.85)
    expect(result.chroma[k]).toBeLessThan(1.3)
  }
})
