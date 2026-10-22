import Dexie, { type EntityTable } from 'dexie'
import { canvasToBlob, decodeImage, scaleToFit } from '../image/canvas'
import { isRawFile, SUPPORTED_IMAGE_TYPES } from '../image/import-formats'
import { RAW_DECODER, RAW_SETTINGS } from '../image/raw-settings'
import { newId } from '../id'
import { cloneDoc, emptyDoc, referencedBlobIds } from '../project/doc'
import type { AlbumRecord, BlobRecord, ProjectDoc, ProjectDocRecord, ProjectRecord } from '../types'

/** 第 1 版的工程记录：文档与 updatedAt 都存在 projects 表里 */
type LegacyProjectRecord = ProjectRecord & { doc?: ProjectDoc, updatedAt?: number }

class PhotoDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>
  docs!: EntityTable<ProjectDocRecord, 'id'>
  blobs!: EntityTable<BlobRecord, 'id'>
  albums!: EntityTable<AlbumRecord, 'id'>

  constructor() {
    super('ai-photo-master')
    // 第 1 版为 projects: 'id, updatedAt'、blobs: 'id, projectId'。Dexie 升级时按数据库现有结构比对，不需要保留旧版本声明；
    // 第 2 版带有迁移文档的 upgrade，从第 1 版升级时要先跑完它，所以保留
    this.version(2).stores({
      projects: 'id',
      docs: 'id, updatedAt',
      blobs: 'id, projectId'
    }).upgrade(async (tx) => {
      const docs: ProjectDocRecord[] = []
      await tx.table<LegacyProjectRecord, string>('projects').toCollection().modify((record) => {
        docs.push({ id: record.id, doc: record.doc ?? emptyDoc(), updatedAt: record.updatedAt ?? record.createdAt })
        delete record.doc
        delete record.updatedAt
      })
      await tx.table<ProjectDocRecord, string>('docs').bulkAdd(docs)
    })
    // 第 3 版新增相册。工程按 albumId 建索引，不在相册中的工程没有这一项、也不进入索引，已有工程无需迁移
    this.version(3).stores({
      projects: 'id, albumId',
      albums: 'id'
    })
  }
}

let instance: PhotoDatabase | null = null

/** 延迟创建，避免在非浏览器环境（构建、测试）中触碰 IndexedDB */
function db(): PhotoDatabase {
  instance ??= new PhotoDatabase()
  return instance
}

/** 打开编辑器所需的完整工程：元数据 + 文档 */
export type Project = ProjectRecord & Pick<ProjectDocRecord, 'doc' | 'updatedAt'>

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'width' | 'height' | 'thumbnail' | 'albumId' | 'order'>

export { SUPPORTED_IMAGE_TYPES } from '../image/import-formats'

/** 新建工程；传入 albumId 时直接放进该相册，传入 filePath 时记下原图在磁盘上的位置（桌面版） */
export async function createProject(file: File, albumId?: string, filePath?: string, signal?: AbortSignal): Promise<string> {
  const raw = isRawFile(file.name)
  if (!raw && !SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`不支持的图片格式：${file.type || '未知'}，请使用 JPEG、PNG、WebP 或相机 RAW`)
  }
  signal?.throwIfAborted()
  const decoded = raw ? await (await import('../image/raw')).decodeRaw(file, signal) : undefined
  const original = decoded?.blob ?? file
  signal?.throwIfAborted()
  const bitmap = await decodeImage(original)
  try {
    const thumbnail = await canvasToBlob(scaleToFit(bitmap, bitmap.width, bitmap.height, 480), 'image/jpeg', 0.85)
    const id = newId()
    const originalBlobId = newId()
    const linearBlobId = decoded ? newId() : undefined
    const rawSource: ProjectRecord['rawSource'] = decoded
      ? {
          blobId: newId(), name: file.name, type: file.type,
          decoder: RAW_DECODER, settings: structuredClone(RAW_SETTINGS),
          cameraMake: decoded.cameraMake, cameraModel: decoded.cameraModel,
          ...(filePath ? { filePath } : {})
        }
      : undefined
    const now = Date.now()
    signal?.throwIfAborted()
    await db().transaction('rw', db().projects, db().docs, db().blobs, db().albums, async (tx) => {
      const abort = () => tx.abort()
      signal?.addEventListener('abort', abort, { once: true })
      tx.on('complete', () => signal?.removeEventListener('abort', abort))
      tx.on('abort', () => signal?.removeEventListener('abort', abort))
      signal?.throwIfAborted()
      if (albumId) {
        await requireAlbum(albumId)
      }
      await db().blobs.add({ id: originalBlobId, projectId: id, blob: original })
      if (decoded && linearBlobId) {
        await db().blobs.add({ id: linearBlobId, projectId: id, blob: decoded.linear })
      }
      if (rawSource) {
        await db().blobs.add({ id: rawSource.blobId, projectId: id, blob: file })
      }
      await db().projects.add({
        id,
        name: file.name.replace(/\.[^.]+$/, '') || '未命名',
        createdAt: now,
        width: bitmap.width,
        height: bitmap.height,
        originalBlobId,
        ...(linearBlobId ? { linearBlobId } : {}),
        originalType: original.type,
        ...(rawSource ? { rawSource } : {}),
        thumbnail,
        ...(albumId ? { albumId } : {}),
        // RAW 只记录来源，不作为「保存」的覆盖目标。
        ...(filePath && !raw ? { filePath } : {})
      })
      await db().docs.add({ id, doc: emptyDoc(), updatedAt: now })
    }).catch((error: unknown) => {
      signal?.throwIfAborted()
      throw error
    })
    return id
  } finally {
    bitmap.close()
  }
}

/** 按最近修改时间倒序列出工程；只遍历 docs 表 updatedAt 索引的键，不读取文档内容 */
export async function listProjects(): Promise<ProjectSummary[]> {
  return db().transaction('r', db().projects, db().docs, async () => {
    const order: Array<{ id: string, updatedAt: number }> = []
    await db().docs.orderBy('updatedAt').reverse().eachKey((updatedAt, cursor) => {
      order.push({ id: cursor.primaryKey, updatedAt: updatedAt as number })
    })
    const records = await db().projects.bulkGet(order.map(item => item.id))
    return order.flatMap(({ updatedAt }, i) => {
      const record = records[i]
      if (!record) {
        return []
      }
      const { id, name, createdAt, width, height, thumbnail, albumId, order } = record
      return [{ id, name, createdAt, updatedAt, width, height, thumbnail, ...(albumId ? { albumId } : {}), ...(order === undefined ? {} : { order }) }]
    })
  })
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db().transaction('r', db().projects, db().docs, async () => {
    const record = await db().projects.get(id)
    const docRecord = await db().docs.get(id)
    return record && docRecord ? { ...record, doc: docRecord.doc, updatedAt: docRecord.updatedAt } : undefined
  })
}

/** 显式从保存的 RAW 原件创建 HDR 副本；旧工程和旧调色不变。 */
export async function createHdrCopy(id: string): Promise<string> {
  const project = await getProject(id)
  if (!project?.rawSource) throw new Error('工程未保留 RAW 原件，请重新导入原始 RAW。')
  const source = project.rawSource
  const raw = await getBlob(source.blobId)
  const copy = await createProject(new File([raw], source.name, { type: source.type }), project.albumId)
  await renameProject(copy, `${project.name} HDR`)
  return copy
}

/**
 * 写入工程文档并刷新修改时间。页面卸载时浏览器不等异步回调，因此只发出一个 put 并立即 commit()：
 * 写入在本轮任务内就完整交给数据库，随后页面被销毁也会提交。先读后写（update）要等读请求的回调
 * 才能发出写请求，卸载时可能被截断。
 */
export async function saveProjectDoc(id: string, doc: ProjectDoc): Promise<void> {
  const record: ProjectDocRecord = { id, doc: cloneDoc(doc), updatedAt: Date.now() }
  await db().transaction('rw', db().docs, (tx) => {
    const written = db().docs.put(record)
    tx.idbtrans.commit()
    return written
  })
}

export async function renameProject(id: string, name: string): Promise<void> {
  await db().transaction('rw', db().projects, db().docs, async () => {
    await db().projects.update(id, { name })
    await db().docs.update(id, { updatedAt: Date.now() })
  })
}

/** 记下工程对应的磁盘文件；不改修改时间（只是文件位置，照片本身没变） */
export async function setProjectFilePath(id: string, filePath: string): Promise<void> {
  if (!await db().projects.update(id, { filePath })) {
    throw new Error('工程不存在或已被删除')
  }
}

export async function deleteProject(id: string): Promise<void> {
  await db().transaction('rw', db().projects, db().docs, db().blobs, async () => {
    await db().blobs.where('projectId').equals(id).delete()
    await db().docs.delete(id)
    await db().projects.delete(id)
  })
}

/** 相册按创建先后排列，新相册排在最后 */
export async function listAlbums(): Promise<AlbumRecord[]> {
  return db().albums.toCollection().sortBy('createdAt')
}

/** emoji 不建索引，相册记录多出这一项不需要升级数据库版本 */
export async function createAlbum(name: string, emoji?: string): Promise<AlbumRecord> {
  const album: AlbumRecord = { id: newId(), name, createdAt: Date.now(), ...(emoji ? { emoji } : {}) }
  await db().albums.add(album)
  return album
}

export async function renameAlbum(id: string, name: string): Promise<void> {
  await db().transaction('rw', db().albums, async () => {
    await requireAlbum(id)
    await db().albums.update(id, { name })
  })
}

/** emoji 为 null 时删除这一项，侧栏改回显示封面 */
export async function setAlbumEmoji(id: string, emoji: string | null): Promise<void> {
  await db().transaction('rw', db().albums, async () => {
    await requireAlbum(id)
    await db().albums.update(id, { emoji: emoji ?? undefined })
  })
}

/** 删除相册只解散分组：其中的工程移出相册、留在图库里（和移出相册一样，不再占着原来的手动位置） */
export async function deleteAlbum(id: string): Promise<void> {
  await db().transaction('rw', db().albums, db().projects, async () => {
    await db().projects.where('albumId').equals(id).modify((project) => {
      delete project.albumId
      delete project.order
    })
    await db().albums.delete(id)
  })
}

/**
 * 把工程移到相册，albumId 为 null 时移出所在相册。这是整理而不是修改，不刷新工程的修改时间。
 * 手动排序的位置只在原来的相册里有意义，所以一并清掉：新来的工程排在最前，和新导入的照片一样
 */
export async function moveProjectToAlbum(projectId: string, albumId: string | null): Promise<void> {
  await db().transaction('rw', db().albums, db().projects, async () => {
    if (albumId) {
      await requireAlbum(albumId)
    }
    // 值为 undefined 时 Dexie 删除该字段，工程随之离开 albumId 索引
    const updated = await db().projects.update(projectId, { albumId: albumId ?? undefined, order: undefined })
    if (!updated && !await db().projects.get(projectId)) {
      throw new Error('工程不存在或已被删除')
    }
  })
}

/** 一次写入多个工程的手动排序位置（工程 id → order）。和移动一样属于整理，不刷新修改时间；已被删除的工程跳过 */
export async function setProjectOrders(orders: ReadonlyMap<string, number>): Promise<void> {
  await db().transaction('rw', db().projects, async () => {
    await db().projects.bulkUpdate([...orders].map(([key, order]) => ({ key, changes: { order } })))
  })
}

/** 相册可能刚在另一个标签页里被删除；写入归属前确认它还在，避免工程指向不存在的相册 */
async function requireAlbum(id: string): Promise<void> {
  if (!await db().albums.get(id)) {
    throw new Error('相册不存在或已被删除')
  }
}

export async function putBlob(projectId: string, blob: Blob): Promise<string> {
  const id = newId()
  await db().blobs.add({ id, projectId, blob })
  return id
}

export async function getBlob(id: string): Promise<Blob> {
  const record = await db().blobs.get(id)
  if (!record) {
    throw new Error('图像数据丢失，可能已被清理')
  }
  return record.blob
}

/**
 * 删除工程中不再被引用的补丁（被撤销或覆盖的重绘结果）。
 * 历史栈只存在于内存中，因此只在打开工程时调用。
 */
export async function collectGarbage(projectId: string, originalBlobId: string, doc: ProjectDoc): Promise<number> {
  const keep = referencedBlobIds(doc)
  keep.add(originalBlobId)
  const project = await db().projects.get(projectId)
  if (project?.linearBlobId) keep.add(project.linearBlobId)
  if (project?.rawSource) {
    keep.add(project.rawSource.blobId)
  }
  const records = await db().blobs.where('projectId').equals(projectId).primaryKeys()
  const stale = records.filter(id => !keep.has(id))
  if (stale.length) {
    await db().blobs.bulkDelete(stale)
  }
  return stale.length
}
