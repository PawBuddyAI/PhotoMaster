import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { makeDng } from '../fixtures/dng'
import { readPng16 } from '../fixtures/png16'
import { skipSetupWizard } from './helpers'

test.beforeEach(({ page }) => skipSetupWizard(page))

test('RAW 真实解码、方向校正、原件保留、重开和全尺寸导出', async ({ page }) => {
  await page.goto('/')
  const bytes = makeDng(6)
  await page.locator('input[type=file]').setInputFiles({ name: 'test.DNG', mimeType: '', buffer: bytes })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()
  await page.reload()
  await expect(page.getByText('正在加载图像')).toBeHidden()
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('ai-photo-master')
      request.onsuccess = () => resolve(request.result)
    })
    const read = <T>(store: string, key?: string) => new Promise<T>((resolve) => {
      const request = key ? db.transaction(store).objectStore(store).get(key) : db.transaction(store).objectStore(store).getAll()
      request.onsuccess = () => resolve(request.result)
    })
    const [project] = await read<Array<{ originalBlobId: string, linearBlobId: string, width: number, height: number, rawSource: { blobId: string, settings: { outputBps: number } } }>>('projects')
    const raw = await read<{ blob: Blob }>('blobs', project!.rawSource.blobId)
    const developed = await read<{ blob: Blob }>('blobs', project!.originalBlobId)
    const linear = await read<{ blob: Blob }>('blobs', project!.linearBlobId)
    const view = new DataView(await linear.blob.arrayBuffer())
    const levels = new Set<number>()
    for (let i = 16; i < view.byteLength; i += 12) levels.add(view.getFloat32(i, true))
    const bitmap = await createImageBitmap(developed.blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    const range = [Math.min(...pixels.filter((_, i) => i % 4 === 0)), Math.max(...pixels.filter((_, i) => i % 4 === 0))]
    bitmap.close()
    db.close()
    return { width: project!.width, height: project!.height, raw: Array.from(new Uint8Array(await raw.blob.arrayBuffer())), type: developed.blob.type, range, levels: levels.size, bits: project!.rawSource.settings.outputBps }
  })
  expect(stored).toMatchObject({ width: 96, height: 128, type: 'image/png' })
  expect(Buffer.from(stored.raw)).toEqual(bytes)
  expect(stored.range[1]! - stored.range[0]!).toBeGreaterThan(50)
  expect(stored.bits).toBe(16)
  expect(stored.levels).toBeGreaterThan(256)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'PNG（16 位，无损）' }).click()
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  const download = await downloadEvent
  const exported = await readFile((await download.path())!)
  expect(exported.length).toBeGreaterThan(100)
  const png16 = readPng16(exported)
  expect(new Set(png16.pixels).size).toBeGreaterThan(256)
  const dimensions = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
    const size = [image.width, image.height]
    image.close()
    return size
  }, [...exported])
  expect(dimensions).toEqual([96, 128])
})

test('损坏 RAW 显示可恢复错误，之后仍可导入', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.CR3', mimeType: '', buffer: Buffer.from('not raw') })
  await expect(page.getByText('无法导入这张 RAW', { exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="description"]').filter({ hasText: /^认不出这个文件：/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '导入照片', exact: true })).toBeEnabled()
  await page.locator('input[type=file]').setInputFiles({ name: 'recovered.dng', mimeType: '', buffer: makeDng() })
  await page.waitForURL(/\/editor\//)
})

test('不支持的压缩方式和超出像素上限都说明具体原因', async ({ page }) => {
  await page.goto('/')
  const description = page.locator('[data-slot="description"]')
  // 52546 是 DNG 1.7 的 JPEG XL 压缩（iPhone 的 JPEG-XL ProRAW），解码器能识别但解不开
  await page.locator('input[type=file]').setInputFiles({ name: 'iphone.DNG', mimeType: '', buffer: makeDng(1, { compression: 52546 }) })
  await expect(description.filter({ hasText: /^这张 DNG 用了暂不支持的压缩方式/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '导入照片', exact: true })).toBeEnabled()
  // 只要文件头：尺寸在解码像素前就会检查
  const huge = makeDng(1, { width: 10_000, height: 6_401, pixel: () => 0 }).subarray(0, 4096)
  await page.locator('input[type=file]').setInputFiles({ name: 'huge.dng', mimeType: '', buffer: huge })
  await expect(description.filter({ hasText: /^这张 RAW 超过 6400 万像素，暂不支持。/ })).toBeVisible()
})

test('拖入解码器打不开的适马 X3F 时提示不支持', async ({ page }) => {
  await page.goto('/')
  const zone = page.getByRole('button', { name: /^拖入照片，或点击选择/ })
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['FOVb'], 'sigma.X3F'))
    return transfer
  })
  for (const type of ['dragenter', 'dragover', 'drop']) await zone.dispatchEvent(type, { dataTransfer })
  await expect(page.getByText('不支持这种文件', { exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="description"]').filter({ hasText: '「sigma.X3F」不是 JPEG、PNG、WebP 或支持的相机 RAW。' })).toBeVisible()
  await expect(page).not.toHaveURL(/\/editor\//)
})

test('6100 万像素 RAW（索尼 α7R V 一档）完整导入并打开', async ({ page }, testInfo) => {
  test.setTimeout(300_000)
  // LibRaw 对索尼 6100 万像素机型的输出可达 9600×6376。文件约 122 MB，写到磁盘按路径选择，
  // 不经 Playwright 协议传输（经路由或参数传这么大的内容会让浏览器连接断开）
  const width = 9600
  const height = 6376
  const path = testInfo.outputPath('a7r5.ARW')
  await writeFile(path, makeDng(1, { width, height }))
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(path)
  await page.waitForURL(/\/editor\//, { timeout: 150_000 })
  await expect(page.getByText('正在加载图像')).toBeHidden({ timeout: 60_000 })
  const stored = await page.evaluate(async () => {
    const { getProject, getBlob } = await import('/_nuxt/lib/storage/db.ts')
    const { linearInfo } = await import('/_nuxt/lib/image/high-depth.ts')
    const project = (await getProject(location.pathname.split('/').at(-1)!))!
    return { width: project.width, height: project.height, linear: await linearInfo(await getBlob(project.linearBlobId!)) }
  })
  expect(stored).toMatchObject({ width, height, linear: { width, height, hdr: true } })
})

test('RAW 解码弹窗在桌面和窄屏显示，取消后可再次导入', async ({ page }, testInfo) => {
  await page.goto('/')
  // 待机 Worker 保持解码中状态，避免悬挂网络请求影响测试退出。
  await page.route(/raw\.worker/, async (route) => {
    await route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () => {}' })
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'cancel.dng', mimeType: '', buffer: makeDng() })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAttribute('data-state', 'open')
  await expect(dialog).toContainText('正在解码 RAW')
  const cancel = dialog.getByRole('button', { name: '取消导入' })
  await expect(cancel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('raw-import-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(cancel).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('raw-import-mobile.png'), animations: 'disabled' })
  await cancel.click()
  await expect(page.getByRole('button', { name: '导入照片', exact: true })).toBeEnabled()
  await expect(cancel).toBeHidden()
  await page.unroute(/raw\.worker/)
  await page.locator('input[type=file]').setInputFiles({ name: 'retry.dng', mimeType: '', buffer: makeDng() })
  await page.waitForURL(/\/editor\//)
})
