import { expect, test } from '@playwright/test'
import { skipSetupWizard } from './helpers'

/**
 * 存储升级：按第 1 版结构（工程文档与 updatedAt 存在 projects 表）预置一个工程，
 * 打开图库后应连续升级到第 3 版（文档移入 docs 表，新增相册表），列表与编辑器中的内容不变。
 * 使用真实浏览器的 IndexedDB，与单元测试（fake-indexeddb）互补。
 */
const LEGACY = {
  id: 'legacy-project',
  name: '升级前的工程',
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 2),
  layerName: '升级前的调整'
}

test.beforeEach(({ page }) => skipSetupWizard(page))

test('第 1 版工程升级后仍在列表中，打开后图层保留', async ({ page }) => {
  // 应用的每个外壳页面都会在侧栏读取图库；在同源但不运行应用的图标文件上按旧结构建库
  await page.goto('/favicon.ico')
  await page.evaluate(async (legacy) => {
    const canvas = new OffscreenCanvas(400, 300)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#4a7a3a'
    ctx.fillRect(0, 0, 400, 300)
    const original = await canvas.convertToBlob({ type: 'image/png' })
    const thumbnail = await canvas.convertToBlob({ type: 'image/jpeg' })
    const params = Object.fromEntries(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance', 'saturation', 'clarity', 'sharpen']
      .map(key => [key, key === 'exposure' ? 0.5 : 0]))
    const layer = {
      id: 'legacy-layer',
      kind: 'adjust',
      name: legacy.layerName,
      enabled: true,
      source: 'user',
      params,
      mask: { shape: 'full', rect: { x: 0, y: 0, w: 1, h: 1 }, line: { x0: 0.5, y0: 0, x1: 0.5, y1: 1 }, feather: 0, invert: false, density: 1, strokes: [] }
    }
    // Dexie 第 1 版对应原生版本 10
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ai-photo-master', 10)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt')
        request.result.createObjectStore('blobs', { keyPath: 'id' }).createIndex('projectId', 'projectId')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['projects', 'blobs'], 'readwrite')
      tx.objectStore('blobs').add({ id: 'legacy-original', projectId: legacy.id, blob: original })
      tx.objectStore('projects').add({
        id: legacy.id,
        name: legacy.name,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        width: 400,
        height: 300,
        originalBlobId: 'legacy-original',
        originalType: 'image/png',
        thumbnail,
        doc: { layers: [layer], crop: null, analysis: null, adopted: [] }
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, LEGACY)

  await page.goto('/')
  const card = page.getByRole('link', { name: new RegExp(LEGACY.name) })
  await expect(card).toBeVisible()
  await expect(card).toContainText('400×300')

  // 迁移后的结构：原生版本 30，文档与修改时间在 docs 表，projects 记录不再含这两项，也不属于任何相册
  const migrated = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ai-photo-master')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const read = <T>(store: string) => new Promise<T>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(id)
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error)
    })
    const project = await read<Record<string, unknown>>('projects')
    const doc = await read<{ updatedAt: number, doc: { layers: Array<{ name: string }> } }>('docs')
    const result = {
      version: db.version,
      stores: [...db.objectStoreNames],
      projectIndexes: [...db.transaction('projects').objectStore('projects').indexNames],
      projectKeys: Object.keys(project).sort(),
      docUpdatedAt: doc.updatedAt,
      docLayers: doc.doc.layers.map(l => l.name)
    }
    db.close()
    return result
  }, LEGACY.id)
  expect(migrated).toEqual({
    version: 30,
    stores: ['albums', 'blobs', 'docs', 'projects'],
    projectIndexes: ['albumId'],
    projectKeys: ['createdAt', 'height', 'id', 'name', 'originalBlobId', 'originalType', 'thumbnail', 'width'],
    docUpdatedAt: LEGACY.updatedAt,
    docLayers: [LEGACY.layerName]
  })

  await card.click()
  await page.waitForURL(`/editor/${LEGACY.id}`)
  await expect(page.getByText('正在加载图像')).toBeHidden()
  await page.getByRole('tab', { name: /图层/ }).click()
  await expect(page.getByRole('tabpanel', { name: '图层' }).getByText(LEGACY.layerName, { exact: true })).toBeVisible()
})
