import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

/** 解码与缩略图依赖浏览器画布，替换为固定尺寸的桩；每个工程的缩略图内容不同，便于核对封面 */
vi.mock('~/lib/image/canvas', () => ({
  decodeImage: vi.fn(async () => ({ width: 1200, height: 800, close: () => {} })),
  scaleToFit: vi.fn(() => ({})),
  canvasToBlob: vi.fn(async () => new Blob(['thumbnail'], { type: 'image/jpeg' }))
}))

let storage: typeof import('~/lib/storage/db')
let useLibraryStore: typeof import('~/stores/library').useLibraryStore

/** 与存储层单测相同：每项测试换新的 IndexedDB 与新的模块实例（数据库实例是单例） */
beforeEach(async () => {
  Dexie.dependencies.indexedDB = new IDBFactory()
  vi.resetModules()
  storage = await import('~/lib/storage/db')
  useLibraryStore = (await import('~/stores/library')).useLibraryStore
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1000)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const photo = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

/** 依次新建工程，每个间隔 1 秒，列表顺序即新建的倒序；按参数个数返回同样长度的 id 元组 */
async function seed<const T extends Array<[name: string, albumId?: string]>>(...specs: T): Promise<{ [K in keyof T]: string }> {
  const ids: string[] = []
  for (const [name, albumId] of specs) {
    vi.setSystemTime(Date.now() + 1000)
    ids.push(await storage.createProject(photo(`${name}.jpg`), albumId))
  }
  return ids as { [K in keyof T]: string }
}

describe('useLibraryStore', () => {
  it('刷新后按相册推导数量与封面，封面取相册里最近修改的工程', async () => {
    const travel = await storage.createAlbum('旅行')
    vi.setSystemTime(1500)
    const empty = await storage.createAlbum('空相册')
    const [a, b, c] = await seed(['a', travel.id], ['b', travel.id], ['c'])
    const library = useLibraryStore()
    expect(library.loaded).toBe(false)

    await library.refresh()

    expect(library.loaded).toBe(true)
    expect(library.projects.map(p => p.id)).toEqual([c, b, a])
    expect(library.projectsIn(null).map(p => p.id)).toEqual([c, b, a])
    expect(library.projectsIn(travel.id).map(p => p.id)).toEqual([b, a])
    expect(library.albumEntries).toEqual([
      { ...travel, count: 2, cover: library.thumbnails[b] },
      { ...empty, count: 0, cover: null }
    ])
    expect(library.findAlbum(empty.id)).toEqual(empty)
  })

  it('缩略图地址按工程缓存：再次刷新只为新工程创建，消失的工程释放地址', async () => {
    const [a, b] = await seed(['a'], ['b'])
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const library = useLibraryStore()
    await library.refresh()
    expect(create).toHaveBeenCalledTimes(2)
    const urlA = library.thumbnails[a]

    // 另一个标签页删除了 b、新建了 c
    await storage.deleteProject(b)
    const [c] = await seed(['c'])
    await library.refresh()

    expect(create).toHaveBeenCalledTimes(3)
    expect(library.thumbnails[a]).toBe(urlA)
    expect(Object.keys(library.thumbnails).sort()).toEqual([a, c].sort())
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('移动工程就地更新列表与相册统计，与数据库一致', async () => {
    const travel = await storage.createAlbum('旅行')
    const [a] = await seed(['a'])
    const library = useLibraryStore()
    await library.refresh()

    await library.moveProject(a, travel.id)
    expect(library.projectsIn(travel.id).map(p => p.id)).toEqual([a])
    expect(library.albumEntries[0]).toMatchObject({ count: 1, cover: library.thumbnails[a] })
    expect(await storage.getProject(a)).toMatchObject({ albumId: travel.id })

    await library.moveProject(a, null)
    expect(library.projects[0]).not.toHaveProperty('albumId')
    expect(library.albumEntries[0]).toMatchObject({ count: 0, cover: null })
    expect(await storage.getProject(a)).not.toHaveProperty('albumId')
  })

  it('移动失败时列表不变', async () => {
    const [a] = await seed(['a'])
    const library = useLibraryStore()
    await library.refresh()

    await expect(library.moveProject(a, 'missing')).rejects.toThrow('相册不存在')
    expect(library.projects[0]).not.toHaveProperty('albumId')
  })

  it('新建相册去掉首尾空白，空名称不创建', async () => {
    const library = useLibraryStore()
    await library.refresh()

    expect(await library.addAlbum('   ')).toBeNull()
    const album = await library.addAlbum('  旅行 ')
    expect(album).toMatchObject({ name: '旅行' })
    expect(library.albums).toEqual([album])
    expect(await storage.listAlbums()).toEqual([album])
  })

  it('新建相册可带 emoji，不带时没有这一项', async () => {
    const library = useLibraryStore()
    await library.refresh()

    const travel = await library.addAlbum('旅行', '✈️')
    vi.setSystemTime(2000)
    const plain = await library.addAlbum('人像', null)
    expect(travel).toMatchObject({ name: '旅行', emoji: '✈️' })
    expect(plain).not.toHaveProperty('emoji')
    expect(library.albumEntries.map(entry => entry.emoji)).toEqual(['✈️', undefined])
    expect(await storage.listAlbums()).toEqual([travel, plain])
  })

  it('更换图标：未改变时不写库，去掉 emoji 后与数据库一致', async () => {
    const library = useLibraryStore()
    await library.refresh()
    const album = (await library.addAlbum('旅行'))!
    const update = vi.spyOn(IDBObjectStore.prototype, 'put')

    await library.setAlbumEmoji(album.id, null)
    expect(update).not.toHaveBeenCalled()

    await library.setAlbumEmoji(album.id, '🏖️')
    expect(library.findAlbum(album.id)?.emoji).toBe('🏖️')
    update.mockClear()
    await library.setAlbumEmoji(album.id, '🏖️')
    expect(update).not.toHaveBeenCalled()

    await library.setAlbumEmoji(album.id, null)
    expect(library.findAlbum(album.id)).not.toHaveProperty('emoji')
    expect((await storage.listAlbums())[0]).not.toHaveProperty('emoji')
  })

  it('更换不存在的相册的图标时报错，列表不变', async () => {
    const library = useLibraryStore()
    await library.refresh()
    const album = (await library.addAlbum('旅行'))!
    await storage.deleteAlbum(album.id)

    await expect(library.setAlbumEmoji(album.id, '⭐')).rejects.toThrow('相册不存在')
    expect(library.findAlbum(album.id)).toEqual(album)
  })

  it('重命名相册：空名称或名称未变时不写库', async () => {
    const library = useLibraryStore()
    await library.refresh()
    const album = (await library.addAlbum('旅行'))!
    const update = vi.spyOn(IDBObjectStore.prototype, 'put')

    await library.renameAlbum(album.id, '  ')
    await library.renameAlbum(album.id, ' 旅行 ')
    expect(update).not.toHaveBeenCalled()

    await library.renameAlbum(album.id, '云南旅行')
    expect(library.findAlbum(album.id)?.name).toBe('云南旅行')
    expect((await storage.listAlbums())[0]?.name).toBe('云南旅行')
  })

  it('删除相册后其中的工程留在图库、不再属于任何相册', async () => {
    const travel = await storage.createAlbum('旅行')
    const [a, b] = await seed(['a', travel.id], ['b'])
    const library = useLibraryStore()
    await library.refresh()

    await library.removeAlbum(travel.id)

    expect(library.albums).toEqual([])
    expect(library.projects.map(p => p.id)).toEqual([b, a])
    expect(library.projects.every(p => !('albumId' in p))).toBe(true)
    expect(await storage.getProject(a)).not.toHaveProperty('albumId')
  })

  it('排序方式默认按最近修改，选择后记在本机，下次启动沿用；无效的存档回到默认', async () => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value)
    })
    const [a, b, c] = await seed(['a'], ['b'], ['c'])
    const library = useLibraryStore()
    await library.refresh()
    expect(library.sortMode).toBe('recent')
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([c, b, a])

    library.sortMode = 'name'
    await nextTick()
    expect(saved.get('apm-library-sort')).toBe('name')
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([a, b, c])
    // 侧栏封面与底图取最近修改的，不随排序变化
    expect(library.projects.map(p => p.id)).toEqual([c, b, a])

    setActivePinia(createPinia())
    expect(useLibraryStore().sortMode).toBe('name')
    saved.set('apm-library-sort', '乱写的')
    setActivePinia(createPinia())
    expect(useLibraryStore().sortMode).toBe('recent')
    vi.unstubAllGlobals()
  })

  it('拖动排序写库后就地更新列表，刷新后顺序不变，排序方式切到手动排序', async () => {
    const [a, b, c] = await seed(['a'], ['b'], ['c'])
    const library = useLibraryStore()
    await library.refresh()
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([c, b, a])

    // 把 a 放到最前：第一次排序给所有工程补上 order
    await library.reorderProject(a, c, 'before', null)

    expect(library.sortMode).toBe('manual')
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([a, c, b])
    // 封面、底图用的最近修改顺序不变
    expect(library.projects.map(p => p.id)).toEqual([c, b, a])
    await library.refresh()
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([a, c, b])
    // 排序属于整理，不刷新修改时间
    expect((await storage.getProject(a))?.updatedAt).toBe(2000)
  })

  it('放回原位时不写库，排序方式也不变', async () => {
    const [a, b] = await seed(['a'], ['b'])
    const library = useLibraryStore()
    await library.refresh()
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')

    await library.reorderProject(b, a, 'before', null)
    await library.reorderProject(b, b, 'after', null)

    expect(put).not.toHaveBeenCalled()
    expect(library.sortMode).toBe('recent')
  })

  it('相册里排序只动相册里的位置；移出相册后工程回到手动顺序的最前', async () => {
    const travel = await storage.createAlbum('旅行')
    const [a, b, c, d] = await seed(['a', travel.id], ['b'], ['c', travel.id], ['d', travel.id])
    const library = useLibraryStore()
    await library.refresh()
    // 先在图库里排成 a b c d
    for (const [id, before] of [[c, d], [b, c], [a, b]] as const) {
      await library.reorderProject(id, before, 'before', null)
    }
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([a, b, c, d])

    await library.reorderProject(d, a, 'before', travel.id)

    expect(library.sortedProjectsIn(travel.id).map(p => p.id)).toEqual([d, a, c])
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([d, b, a, c])

    // 移出相册：不再占着手动位置，排在最前；列表与数据库一致
    await library.moveProject(a, null)
    expect(library.sortedProjectsIn(null)[0]?.id).toBe(a)
    expect(library.projects.find(p => p.id === a)).not.toHaveProperty('order')
    await library.refresh()
    expect(library.sortedProjectsIn(null)[0]?.id).toBe(a)
  })

  it('删除相册后其中的工程同样排到手动顺序的最前', async () => {
    const travel = await storage.createAlbum('旅行')
    const [a, b] = await seed(['a', travel.id], ['b'])
    const library = useLibraryStore()
    await library.refresh()
    await library.reorderProject(a, b, 'before', null)
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([a, b])

    await library.removeAlbum(travel.id)

    expect(library.projects.every(p => !('order' in p) || p.id === b)).toBe(true)
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([a, b])
    await library.refresh()
    expect(library.sortedProjectsIn(null).map(p => p.id)).toEqual([a, b])
  })

  it('删除工程立即从列表移除，缩略图地址在离场过渡结束后释放', async () => {
    const [a, b] = await seed(['a'], ['b'])
    const library = useLibraryStore()
    await library.refresh()
    const url = library.thumbnails[a]
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })

    await library.removeProject(a)

    expect(library.projects.map(p => p.id)).toEqual([b])
    expect(await storage.getProject(a)).toBeUndefined()
    // 淡出期间卡片仍引用这个地址
    expect(library.thumbnails[a]).toBe(url)
    expect(revoke).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(revoke).toHaveBeenCalledWith(url)
    expect(library.thumbnails).not.toHaveProperty(a)
  })
})
