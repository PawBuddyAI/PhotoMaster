import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdjustmentLayer, createGenerativeLayer, emptyDoc } from '~/lib/project/doc'
import type { ProjectDoc } from '~/lib/types'

/** 解码与缩略图依赖浏览器画布，替换为固定尺寸的桩 */
vi.mock('~/lib/image/canvas', () => ({
  decodeImage: vi.fn(async () => ({ width: 1200, height: 800, close: () => {} })),
  scaleToFit: vi.fn(() => ({})),
  canvasToBlob: vi.fn(async () => new Blob(['thumbnail'], { type: 'image/jpeg' }))
}))

vi.mock('~/lib/image/raw', () => ({
  decodeRaw: vi.fn(async () => ({ blob: new Blob(['developed'], { type: 'image/png' }), linear: new Blob(['linear16']), cameraMake: 'Test', cameraModel: 'Camera' }))
}))

const DB_NAME = 'ai-photo-master'

let storage: typeof import('~/lib/storage/db')

/** 每项测试使用全新的 IndexedDB（fake-indexeddb）与全新的存储模块：模块里的数据库实例是单例 */
beforeEach(async () => {
  Dexie.dependencies.indexedDB = new IDBFactory()
  vi.resetModules()
  storage = await import('~/lib/storage/db')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1000)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 以动态模式打开同一个数据库，直接检查各表内容与结构 */
async function inspect<T>(read: (raw: Dexie) => Promise<T>): Promise<T> {
  const raw = new Dexie(DB_NAME)
  await raw.open()
  try {
    return await read(raw)
  } finally {
    raw.close()
  }
}

const photo = (name = 'photo.jpg') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

function docWithLayers(...names: string[]): ProjectDoc {
  return { ...emptyDoc(), layers: names.map(name => createAdjustmentLayer({ name })) }
}

/** 记录 IndexedDB 请求（对象仓库与索引上的读写）和事务提交 */
function recordRequests() {
  const requests: string[] = []
  const track = (proto: object, names: string[]) => {
    for (const name of names) {
      const original = Reflect.get(proto, name) as (...args: unknown[]) => unknown
      vi.spyOn(proto as Record<string, (...args: unknown[]) => unknown>, name).mockImplementation(function (this: IDBObjectStore | IDBIndex, ...args: unknown[]) {
        const store = 'objectStore' in this ? `${this.objectStore.name}.${this.name}` : this.name
        requests.push(`${name}(${store})`)
        return original.apply(this, args)
      })
    }
  }
  track(IDBObjectStore.prototype, ['put', 'add', 'get', 'getAll', 'openCursor', 'openKeyCursor', 'delete'])
  track(IDBIndex.prototype, ['get', 'getAll', 'openCursor', 'openKeyCursor'])
  const commit = vi.spyOn(IDBTransaction.prototype, 'commit')
  return { requests, commit }
}

describe('第 1 版数据库升级', () => {
  /** 按第 1 版结构建库：文档与 updatedAt 存在 projects 表里，updatedAt 有索引 */
  async function seedLegacy(projects: Array<Record<string, unknown>>, blobs: Array<{ id: string, projectId: string, blob: Blob }>) {
    const legacy = new Dexie(DB_NAME)
    legacy.version(1).stores({ projects: 'id, updatedAt', blobs: 'id, projectId' })
    await legacy.table('projects').bulkAdd(projects)
    await legacy.table('blobs').bulkAdd(blobs)
    legacy.close()
  }

  const legacyProject = (id: string, fields: Record<string, unknown>) => ({
    id,
    name: `工程 ${id}`,
    createdAt: 100,
    width: 1200,
    height: 800,
    originalBlobId: `${id}-original`,
    originalType: 'image/jpeg',
    thumbnail: new Blob([id]),
    ...fields
  })

  it('文档与修改时间迁到 docs 表，元数据与图像保留，列表顺序不变', async () => {
    const docA = docWithLayers('调整 1', '调整 2')
    await seedLegacy(
      [legacyProject('a', { updatedAt: 3000, doc: docA }), legacyProject('b', { updatedAt: 5000, doc: emptyDoc() })],
      [
        { id: 'a-original', projectId: 'a', blob: new Blob(['a']) },
        { id: 'b-original', projectId: 'b', blob: new Blob(['b']) }
      ]
    )

    const list = await storage.listProjects()
    expect(list.map(p => [p.id, p.name, p.updatedAt])).toEqual([['b', '工程 b', 5000], ['a', '工程 a', 3000]])
    expect(await storage.getProject('a')).toMatchObject({ id: 'a', originalBlobId: 'a-original', createdAt: 100, updatedAt: 3000, doc: docA })

    await inspect(async (raw) => {
      // 连续跑完 1 → 2 → 3 两次升级
      expect(raw.verno).toBe(3)
      expect(raw.tables.map(t => t.name).sort()).toEqual(['albums', 'blobs', 'docs', 'projects'])
      // projects 表不再有 updatedAt 索引，记录里也不再有文档与修改时间；第 3 版加上的相册索引里没有旧工程
      expect(raw.table('projects').schema.indexes.map(i => i.name)).toEqual(['albumId'])
      expect(await raw.table('projects').where('albumId').notEqual('').count()).toBe(0)
      for (const record of await raw.table('projects').toArray()) {
        expect(record).not.toHaveProperty('doc')
        expect(record).not.toHaveProperty('updatedAt')
        expect(record.thumbnail).toBeInstanceOf(Blob)
      }
      expect(raw.table('docs').schema.indexes.map(i => i.name)).toEqual(['updatedAt'])
      expect(await raw.table('docs').toArray()).toEqual([
        { id: 'a', doc: docA, updatedAt: 3000 },
        { id: 'b', doc: emptyDoc(), updatedAt: 5000 }
      ])
      expect(await raw.table('blobs').count()).toBe(2)
    })
  })

  it('缺少文档或修改时间的旧记录以空文档和创建时间补齐', async () => {
    await seedLegacy([legacyProject('a', {})], [])

    expect(await storage.getProject('a')).toMatchObject({ doc: emptyDoc(), updatedAt: 100 })
    expect((await storage.listProjects()).map(p => p.id)).toEqual(['a'])
  })

  it('没有旧数据时直接建立第 3 版结构', async () => {
    expect(await storage.listProjects()).toEqual([])
    expect(await storage.listAlbums()).toEqual([])
    await inspect(async (raw) => {
      expect(raw.verno).toBe(3)
      expect(raw.tables.map(t => t.name).sort()).toEqual(['albums', 'blobs', 'docs', 'projects'])
    })
  })
})

describe('第 2 版数据库升级', () => {
  it('新增相册表与相册索引，已有工程原样保留且不属于任何相册', async () => {
    const doc = docWithLayers('调整 1')
    const legacy = new Dexie(DB_NAME)
    legacy.version(2).stores({ projects: 'id', docs: 'id, updatedAt', blobs: 'id, projectId' })
    await legacy.table('projects').add({
      id: 'a',
      name: '工程 a',
      createdAt: 100,
      width: 1200,
      height: 800,
      originalBlobId: 'a-original',
      originalType: 'image/jpeg',
      thumbnail: new Blob(['a'])
    })
    await legacy.table('docs').add({ id: 'a', doc, updatedAt: 2000 })
    await legacy.table('blobs').add({ id: 'a-original', projectId: 'a', blob: new Blob(['a']) })
    legacy.close()

    expect(await storage.listProjects()).toEqual([expect.not.objectContaining({ albumId: expect.anything() })])
    expect(await storage.getProject('a')).toMatchObject({ name: '工程 a', updatedAt: 2000, doc })
    await inspect(async (raw) => {
      expect(raw.verno).toBe(3)
      expect(raw.table('projects').schema.indexes.map(i => i.name)).toEqual(['albumId'])
      expect(await raw.table('albums').count()).toBe(0)
      expect(await raw.table('projects').get('a')).not.toHaveProperty('albumId')
    })

    // 升级后的旧工程可以放进新相册
    const album = await storage.createAlbum('旅行')
    await storage.moveProjectToAlbum('a', album.id)
    expect((await storage.listProjects())[0]).toMatchObject({ id: 'a', albumId: album.id, updatedAt: 2000 })
  })
})

describe('工程读写', () => {
  it('HDR 副本重新显影原件，旧文档和原件保持不变', async () => {
    const id = await storage.createProject(new File(['raw-original'], 'old.dng'))
    const previous = (await storage.getProject(id))!
    previous.doc.hdr = { preview: 'sdr', referenceWhite: 100, peakNits: 600 }
    await storage.saveProjectDoc(id, previous.doc)
    const copy = await storage.createHdrCopy(id)
    const next = (await storage.getProject(copy))!
    expect(copy).not.toBe(id)
    expect(next.name).toBe('old HDR')
    expect(next.doc.hdr).toBeUndefined()
    expect((await storage.getProject(id))!.doc).toEqual(previous.doc)
    expect(await (await storage.getBlob(next.rawSource!.blobId)).text()).toBe('raw-original')
    await storage.deleteProject(copy)
    expect(await (await storage.getBlob(previous.rawSource!.blobId)).text()).toBe('raw-original')
  })

  it('RAW 保留原件、16 位底图与显示副本；清理补丁不删除底图，删除工程一并释放', async () => {
    const file = new File(['sensor-data'], '海边.ARW', { type: '' })
    const id = await storage.createProject(file, undefined, 'D:\\海边.ARW')
    const project = (await storage.getProject(id))!
    expect(project.originalType).toBe('image/png')
    expect(project).not.toHaveProperty('filePath')
    expect(project.rawSource).toMatchObject({ name: '海边.ARW', filePath: 'D:\\海边.ARW', decoder: 'libraw-wasm@1.6.0', settings: { outputBps: 16, halfSize: false, gamm: [1, 1, 0, 0, 0, 0], noAutoBright: true, noAutoScale: true, outputColor: 0 } })
    expect(await (await storage.getBlob(project.linearBlobId!)).text()).toBe('linear16')
    expect(await (await storage.getBlob(project.originalBlobId)).text()).toBe('developed')
    expect(await (await storage.getBlob(project.rawSource!.blobId)).text()).toBe('sensor-data')
    const stale = await storage.putBlob(id, new Blob(['unused']))
    expect(await storage.collectGarbage(id, project.originalBlobId, project.doc)).toBe(1)
    await expect(storage.getBlob(stale)).rejects.toThrow('图像数据丢失')
    expect(await (await storage.getBlob(project.linearBlobId!)).text()).toBe('linear16')
    expect(await (await storage.getBlob(project.rawSource!.blobId)).text()).toBe('sensor-data')
    await storage.deleteProject(id)
    await expect(storage.getBlob(project.linearBlobId!)).rejects.toThrow('图像数据丢失')
    await expect(storage.getBlob(project.rawSource!.blobId)).rejects.toThrow('图像数据丢失')
  })

  it('RAW 解码失败或取消不留下半成品工程', async () => {
    const { decodeRaw } = await import('~/lib/image/raw')
    vi.mocked(decodeRaw).mockRejectedValueOnce(new Error('不支持此机型'))
    await expect(storage.createProject(new File(['bad'], 'broken.CR3'))).rejects.toThrow('不支持此机型')
    const controller = new AbortController()
    controller.abort()
    await expect(storage.createProject(new File(['raw'], 'photo.NEF'), undefined, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await storage.listProjects()).toEqual([])
    expect(await inspect(db => db.table('blobs').count())).toBe(0)
  })

  it('新建工程同时写入元数据、空文档与原图', async () => {
    const id = await storage.createProject(photo('海边.jpg'))

    const project = await storage.getProject(id)
    expect(project).toMatchObject({ id, name: '海边', createdAt: 1000, updatedAt: 1000, width: 1200, height: 800, originalType: 'image/jpeg', doc: emptyDoc() })
    expect(await (await storage.getBlob(project!.originalBlobId)).text()).toBe('\u0001\u0002\u0003')
    expect(await storage.listProjects()).toEqual([expect.objectContaining({ id, name: '海边', updatedAt: 1000 })])
  })

  it('记下原图的磁盘位置（桌面版）：没有时记录里不带这一项，之后可以改，不刷新修改时间', async () => {
    const loose = await storage.createProject(photo('a.jpg'))
    expect(await storage.getProject(loose)).not.toHaveProperty('filePath')

    const id = await storage.createProject(photo('海边.jpg'), undefined, 'D:\\照片\\海边.jpg')
    expect(await storage.getProject(id)).toMatchObject({ filePath: 'D:\\照片\\海边.jpg', updatedAt: 1000 })

    vi.setSystemTime(5000)
    await storage.setProjectFilePath(loose, 'E:\\导出\\a.jpg')
    expect(await storage.getProject(loose)).toMatchObject({ filePath: 'E:\\导出\\a.jpg', updatedAt: 1000 })
    expect(await storage.getProject(id)).toMatchObject({ filePath: 'D:\\照片\\海边.jpg' })
  })

  it('给不存在的工程记位置时报错', async () => {
    await expect(storage.setProjectFilePath('missing', 'D:\\a.jpg')).rejects.toThrow('工程不存在')
  })

  it('不支持的格式不写入任何记录', async () => {
    await expect(storage.createProject(new File(['x'], 'a.gif', { type: 'image/gif' }))).rejects.toThrow('不支持的图片格式')
    expect(await storage.listProjects()).toEqual([])
  })

  it('保存文档只发出一次 put 并立即提交，修改时间刷新、列表随之重排', async () => {
    const first = await storage.createProject(photo('a.jpg'))
    vi.setSystemTime(2000)
    const second = await storage.createProject(photo('b.jpg'))
    expect((await storage.listProjects()).map(p => p.id)).toEqual([second, first])

    vi.setSystemTime(3000)
    const doc = docWithLayers('调整 1')
    const { requests, commit } = recordRequests()
    await storage.saveProjectDoc(first, doc)

    expect(requests).toEqual(['put(docs)'])
    expect(commit).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
    expect(await storage.getProject(first)).toMatchObject({ name: 'a', updatedAt: 3000, doc })
    expect((await storage.listProjects()).map(p => [p.id, p.updatedAt])).toEqual([[first, 3000], [second, 2000]])
  })

  it('写入的是调用时的文档快照，之后的修改不影响本次写入', async () => {
    const id = await storage.createProject(photo())
    const doc = docWithLayers('调整 1')
    const saving = storage.saveProjectDoc(id, doc)
    doc.layers.push(createGenerativeLayer({ name: '重绘 1' }))
    await saving

    expect((await storage.getProject(id))!.doc.layers.map(l => l.name)).toEqual(['调整 1'])
  })

  it('写入失败时抛出错误，已保存的文档与修改时间不变', async () => {
    const id = await storage.createProject(photo())
    await storage.saveProjectDoc(id, docWithLayers('调整 1'))
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('空间不足', 'QuotaExceededError')
    })
    vi.setSystemTime(5000)

    await expect(storage.saveProjectDoc(id, docWithLayers('调整 1', '调整 2'))).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(await storage.getProject(id)).toMatchObject({ updatedAt: 1000, doc: { layers: [expect.objectContaining({ name: '调整 1' })] } })

    // 之后的保存不受影响
    await storage.saveProjectDoc(id, docWithLayers('调整 3'))
    expect((await storage.getProject(id))!.doc.layers.map(l => l.name)).toEqual(['调整 3'])
  })

  it('重命名更新名称与修改时间，文档不变', async () => {
    const id = await storage.createProject(photo())
    const doc = docWithLayers('调整 1')
    await storage.saveProjectDoc(id, doc)
    vi.setSystemTime(4000)
    await storage.renameProject(id, '新名字')

    expect(await storage.getProject(id)).toMatchObject({ name: '新名字', updatedAt: 4000, doc })
  })

  it('删除工程移除三张表中的记录，不影响其他工程', async () => {
    const removed = await storage.createProject(photo('a.jpg'))
    const kept = await storage.createProject(photo('b.jpg'))
    await storage.putBlob(removed, new Blob(['patch']))
    await storage.deleteProject(removed)

    expect(await storage.getProject(removed)).toBeUndefined()
    expect((await storage.listProjects()).map(p => p.id)).toEqual([kept])
    await inspect(async (raw) => {
      expect(await raw.table('docs').toCollection().primaryKeys()).toEqual([kept])
      expect(await raw.table('blobs').where('projectId').equals(removed).count()).toBe(0)
      expect(await raw.table('blobs').where('projectId').equals(kept).count()).toBe(1)
    })
  })

  it('列表只遍历修改时间索引的键，不读取文档内容', async () => {
    await storage.createProject(photo('a.jpg'))
    await storage.createProject(photo('b.jpg'))
    const { requests } = recordRequests()
    await storage.listProjects()

    expect(requests.filter(r => r.includes('docs'))).toEqual(['openKeyCursor(docs.updatedAt)'])
  })

  it('打开不存在的工程返回 undefined', async () => {
    expect(await storage.getProject('missing')).toBeUndefined()
  })

  it('清理不再被文档引用的补丁，保留原图', async () => {
    const id = await storage.createProject(photo())
    const project = (await storage.getProject(id))!
    const used = await storage.putBlob(id, new Blob(['used']))
    const stale = await storage.putBlob(id, new Blob(['stale']))
    const layer = createGenerativeLayer({ name: '重绘 1' })
    layer.result = { blobId: used, x: 0, y: 0, w: 10, h: 10 }
    const doc: ProjectDoc = { ...emptyDoc(), layers: [layer] }

    expect(await storage.collectGarbage(id, project.originalBlobId, doc)).toBe(1)
    await expect(storage.getBlob(stale)).rejects.toThrow('图像数据丢失')
    expect(await (await storage.getBlob(used)).text()).toBe('used')
    expect(await (await storage.getBlob(project.originalBlobId)).text()).toBe('\u0001\u0002\u0003')
  })
})

describe('相册', () => {
  /** 工程在数据库中的原始记录，用来确认移出相册后字段确实被删除，而不是存成 undefined */
  const rawProject = (id: string) => inspect(raw => raw.table('projects').get(id))

  it('按创建先后列出，重命名只改名称', async () => {
    const first = await storage.createAlbum('旅行')
    vi.setSystemTime(2000)
    const second = await storage.createAlbum('人像')
    expect(await storage.listAlbums()).toEqual([
      { id: first.id, name: '旅行', createdAt: 1000 },
      { id: second.id, name: '人像', createdAt: 2000 }
    ])

    await storage.renameAlbum(first.id, '云南旅行')
    expect((await storage.listAlbums()).map(a => [a.id, a.name, a.createdAt])).toEqual([[first.id, '云南旅行', 1000], [second.id, '人像', 2000]])
    await expect(storage.renameAlbum('missing', '名字')).rejects.toThrow('相册不存在')
  })

  it('emoji 可在新建时指定、之后更换或去掉，去掉后记录不再含这一项', async () => {
    const plain = await storage.createAlbum('人像')
    vi.setSystemTime(2000)
    const travel = await storage.createAlbum('旅行', '✈️')
    expect(plain).not.toHaveProperty('emoji')
    expect(travel).toMatchObject({ emoji: '✈️' })
    expect(await storage.listAlbums()).toEqual([plain, travel])

    await storage.setAlbumEmoji(plain.id, '👨‍👩‍👧')
    await storage.setAlbumEmoji(travel.id, null)
    const rawAlbum = (id: string) => inspect(raw => raw.table('albums').get(id))
    expect(await rawAlbum(plain.id)).toMatchObject({ name: '人像', emoji: '👨‍👩‍👧' })
    expect(await rawAlbum(travel.id)).not.toHaveProperty('emoji')
    await expect(storage.setAlbumEmoji('missing', '⭐')).rejects.toThrow('相册不存在')
  })

  it('在相册中新建的工程带有归属，列表摘要随之返回；图库里新建的工程没有这一项', async () => {
    const album = await storage.createAlbum('旅行')
    const inAlbum = await storage.createProject(photo('a.jpg'), album.id)
    const loose = await storage.createProject(photo('b.jpg'))

    expect(await storage.getProject(inAlbum)).toMatchObject({ albumId: album.id })
    expect(await rawProject(loose)).not.toHaveProperty('albumId')
    const list = await storage.listProjects()
    expect(list.find(p => p.id === inAlbum)).toMatchObject({ albumId: album.id })
    expect(list.find(p => p.id === loose)).not.toHaveProperty('albumId')
  })

  it('在不存在的相册中新建工程时不写入任何记录', async () => {
    await expect(storage.createProject(photo(), 'missing')).rejects.toThrow('相册不存在')
    expect(await storage.listProjects()).toEqual([])
    await inspect(async (raw) => {
      expect(await raw.table('docs').count()).toBe(0)
      expect(await raw.table('blobs').count()).toBe(0)
    })
  })

  it('移到相册、换相册、移出相册都不刷新修改时间，移出后记录不再含相册字段', async () => {
    const travel = await storage.createAlbum('旅行')
    const portrait = await storage.createAlbum('人像')
    const id = await storage.createProject(photo())
    vi.setSystemTime(5000)

    await storage.moveProjectToAlbum(id, travel.id)
    expect(await storage.getProject(id)).toMatchObject({ albumId: travel.id, updatedAt: 1000 })
    await storage.moveProjectToAlbum(id, portrait.id)
    expect(await storage.getProject(id)).toMatchObject({ albumId: portrait.id, updatedAt: 1000 })

    await storage.moveProjectToAlbum(id, null)
    expect(await rawProject(id)).not.toHaveProperty('albumId')
    expect(await storage.getProject(id)).toMatchObject({ updatedAt: 1000 })
    // 本来就不在相册中时再移出，不报错
    await storage.moveProjectToAlbum(id, null)
  })

  it('移到不存在的相册或移动不存在的工程时报错，归属不变', async () => {
    const album = await storage.createAlbum('旅行')
    const id = await storage.createProject(photo(), album.id)

    await expect(storage.moveProjectToAlbum(id, 'missing')).rejects.toThrow('相册不存在')
    expect(await storage.getProject(id)).toMatchObject({ albumId: album.id })
    await expect(storage.moveProjectToAlbum('missing', album.id)).rejects.toThrow('工程不存在')
    await expect(storage.moveProjectToAlbum('missing', null)).rejects.toThrow('工程不存在')
  })

  it('删除相册只解散分组：其中的工程留在图库并移出相册，其他相册不受影响', async () => {
    const removed = await storage.createAlbum('旅行')
    const kept = await storage.createAlbum('人像')
    const a = await storage.createProject(photo('a.jpg'), removed.id)
    const b = await storage.createProject(photo('b.jpg'), removed.id)
    const c = await storage.createProject(photo('c.jpg'), kept.id)
    const d = await storage.createProject(photo('d.jpg'))

    await storage.deleteAlbum(removed.id)

    expect((await storage.listAlbums()).map(album => album.id)).toEqual([kept.id])
    expect((await storage.listProjects()).map(p => p.id).sort()).toEqual([a, b, c, d].sort())
    expect(await rawProject(a)).not.toHaveProperty('albumId')
    expect(await rawProject(b)).not.toHaveProperty('albumId')
    expect(await storage.getProject(c)).toMatchObject({ albumId: kept.id })
    await inspect(async (raw) => {
      expect(await raw.table('projects').where('albumId').equals(removed.id).count()).toBe(0)
    })
  })

  it('删除工程不影响它所在的相册', async () => {
    const album = await storage.createAlbum('旅行')
    const id = await storage.createProject(photo(), album.id)
    await storage.deleteProject(id)

    expect(await storage.listAlbums()).toEqual([album])
  })
})

describe('手动排序', () => {
  /** 工程在数据库中的原始记录，用来确认 order 确实被删除，而不是存成 undefined */
  const rawProject = (id: string) => inspect(raw => raw.table('projects').get(id))

  it('新建的工程没有 order；批量写入后列表摘要带上它，不刷新修改时间，已删除的工程跳过', async () => {
    const a = await storage.createProject(photo('a.jpg'))
    const b = await storage.createProject(photo('b.jpg'))
    const gone = await storage.createProject(photo('gone.jpg'))
    await storage.deleteProject(gone)
    expect(await rawProject(a)).not.toHaveProperty('order')
    vi.setSystemTime(5000)

    await storage.setProjectOrders(new Map([[a, 2], [b, -1], [gone, 7]]))

    const byId = Object.fromEntries((await storage.listProjects()).map(p => [p.id, p]))
    expect(byId[a]).toMatchObject({ order: 2, updatedAt: 1000 })
    expect(byId[b]).toMatchObject({ order: -1, updatedAt: 1000 })
    expect(Object.keys(byId)).not.toContain(gone)
  })

  it('order 为 0 也如实返回，而不是被当成没有', async () => {
    const a = await storage.createProject(photo('a.jpg'))
    await storage.setProjectOrders(new Map([[a, 0]]))

    expect((await storage.listProjects())[0]).toHaveProperty('order', 0)
  })

  it('移动工程与删除相册都会清掉 order，新来的工程排在手动顺序的最前', async () => {
    const travel = await storage.createAlbum('旅行')
    const a = await storage.createProject(photo('a.jpg'))
    const b = await storage.createProject(photo('b.jpg'), travel.id)
    await storage.setProjectOrders(new Map([[a, 1], [b, 2]]))

    await storage.moveProjectToAlbum(a, travel.id)
    expect(await rawProject(a)).not.toHaveProperty('order')
    expect(await rawProject(b)).toHaveProperty('order', 2)

    await storage.setProjectOrders(new Map([[a, 1]]))
    await storage.deleteAlbum(travel.id)
    expect(await rawProject(a)).not.toHaveProperty('order')
    expect(await rawProject(b)).not.toHaveProperty('order')
  })

  it('整个批次在一个事务里：失败时一个都不写', async () => {
    const a = await storage.createProject(photo('a.jpg'))
    const b = await storage.createProject(photo('b.jpg'))
    await storage.setProjectOrders(new Map([[a, 1], [b, 2]]))

    await expect(storage.setProjectOrders(new Map([[a, 5], [b, Symbol('坏值') as unknown as number]]))).rejects.toThrow()

    expect(await rawProject(a)).toHaveProperty('order', 1)
    expect(await rawProject(b)).toHaveProperty('order', 2)
  })
})
