import Dexie, { type EntityTable } from 'dexie'
import { canvasToBlob, decodeImage, scaleToFit } from '../image/canvas'
import { newId } from '../id'
import { cloneDoc, emptyDoc, referencedBlobIds } from '../project/doc'
import type { BlobRecord, ProjectDoc, ProjectDocRecord, ProjectRecord } from '../types'

/** 第 1 版的工程记录：文档与 updatedAt 都存在 projects 表里 */
type LegacyProjectRecord = ProjectRecord & { doc?: ProjectDoc, updatedAt?: number }

class PhotoDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>
  docs!: EntityTable<ProjectDocRecord, 'id'>
  blobs!: EntityTable<BlobRecord, 'id'>

  constructor() {
    super('ai-photo-master')
    // 第 1 版为 projects: 'id, updatedAt'、blobs: 'id, projectId'。Dexie 升级时按数据库现有结构比对，不需要保留旧版本声明
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

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'width' | 'height' | 'thumbnail'>

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function createProject(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`不支持的图片格式：${file.type || '未知'}，请使用 JPEG、PNG 或 WebP`)
  }
  const bitmap = await decodeImage(file)
  try {
    const thumbnail = await canvasToBlob(scaleToFit(bitmap, bitmap.width, bitmap.height, 480), 'image/jpeg', 0.85)
    const id = newId()
    const originalBlobId = newId()
    const now = Date.now()
    await db().transaction('rw', db().projects, db().docs, db().blobs, async () => {
      await db().blobs.add({ id: originalBlobId, projectId: id, blob: file })
      await db().projects.add({
        id,
        name: file.name.replace(/\.[^.]+$/, '') || '未命名',
        createdAt: now,
        width: bitmap.width,
        height: bitmap.height,
        originalBlobId,
        originalType: file.type,
        thumbnail
      })
      await db().docs.add({ id, doc: emptyDoc(), updatedAt: now })
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
      const { id, name, createdAt, width, height, thumbnail } = record
      return [{ id, name, createdAt, updatedAt, width, height, thumbnail }]
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

export async function deleteProject(id: string): Promise<void> {
  await db().transaction('rw', db().projects, db().docs, db().blobs, async () => {
    await db().blobs.where('projectId').equals(id).delete()
    await db().docs.delete(id)
    await db().projects.delete(id)
  })
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
  const records = await db().blobs.where('projectId').equals(projectId).primaryKeys()
  const stale = records.filter(id => !keep.has(id))
  if (stale.length) {
    await db().blobs.bulkDelete(stale)
  }
  return stale.length
}
