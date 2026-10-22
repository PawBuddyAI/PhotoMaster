import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { makeDng } from '../fixtures/dng'
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
    const [project] = await read<Array<{ originalBlobId: string, width: number, height: number, rawSource: { blobId: string } }>>('projects')
    const raw = await read<{ blob: Blob }>('blobs', project!.rawSource.blobId)
    const developed = await read<{ blob: Blob }>('blobs', project!.originalBlobId)
    const bitmap = await createImageBitmap(developed.blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    const range = [Math.min(...pixels.filter((_, i) => i % 4 === 0)), Math.max(...pixels.filter((_, i) => i % 4 === 0))]
    bitmap.close()
    db.close()
    return { width: project!.width, height: project!.height, raw: Array.from(new Uint8Array(await raw.blob.arrayBuffer())), type: developed.blob.type, range }
  })
  expect(stored).toMatchObject({ width: 96, height: 128, type: 'image/png' })
  expect(Buffer.from(stored.raw)).toEqual(bytes)
  expect(stored.range[1]! - stored.range[0]!).toBeGreaterThan(50)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /导出/ }).click()
  const download = await downloadEvent
  const exported = await readFile((await download.path())!)
  expect(exported.length).toBeGreaterThan(100)
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
  await expect(page.getByText(/无法解码这张 RAW/)).toBeVisible()
  await expect(page.getByRole('button', { name: '导入照片', exact: true })).toBeEnabled()
  await page.locator('input[type=file]').setInputFiles({ name: 'recovered.dng', mimeType: '', buffer: makeDng() })
  await page.waitForURL(/\/editor\//)
})

test('取消解码可再次导入，不留下工程', async ({ page }) => {
  await page.goto('/')
  // 阻止解码 Worker 加载，保证取消发生在解码完成前。
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/raw\.worker/, async (route) => {
    await blocked
    await route.abort().catch(() => {})
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'cancel.dng', mimeType: '', buffer: makeDng() })
  const cancel = page.getByRole('button', { name: '取消导入' })
  await expect(cancel).toBeVisible()
  await cancel.click()
  await expect(page.getByRole('button', { name: '导入照片', exact: true })).toBeEnabled()
  await expect(cancel).toBeHidden()
  release()
  await page.unroute(/raw\.worker/)
  await page.locator('input[type=file]').setInputFiles({ name: 'retry.dng', mimeType: '', buffer: makeDng() })
  await page.waitForURL(/\/editor\//)
})
