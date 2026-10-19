import Dexie, { type EntityTable } from 'dexie'
import { canvasToBlob, decodeImage, scaleToFit } from '../image/canvas'
import { newId } from '../id'
import { cloneDoc, emptyDoc, referencedBlobIds } from '../project/doc'
import type { BlobRecord, ProjectDoc, ProjectRecord } from '../types'

class PhotoDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>
  blobs!: EntityTable<BlobRecord, 'id'>

  constructor() {
    super('ai-photo-master')
    this.version(1).stores({
      projects: 'id, updatedAt',
      blobs: 'id, projectId'
    })
  }
}

let instance: PhotoDatabase | null = null

/** 延迟创建，避免在非浏览器环境（构建、测试）中触碰 IndexedDB */
function db(): PhotoDatabase {
  instance ??= new PhotoDatabase()
  return instance
}

export type ProjectSummary = Pick<ProjectRecord, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'width' | 'height' | 'thumbnail'>

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
    await db().transaction('rw', db().projects, db().blobs, async () => {
      await db().blobs.add({ id: originalBlobId, projectId: id, blob: file })
      await db().projects.add({
        id,
        name: file.name.replace(/\.[^.]+$/, '') || '未命名',
        createdAt: now,
        updatedAt: now,
        width: bitmap.width,
        height: bitmap.height,
        originalBlobId,
        originalType: file.type,
        thumbnail,
        doc: emptyDoc()
      })
    })
    return id
  } finally {
    bitmap.close()
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await db().projects.orderBy('updatedAt').reverse().toArray()
  return records.map(({ id, name, createdAt, updatedAt, width, height, thumbnail }) =>
    ({ id, name, createdAt, updatedAt, width, height, thumbnail }))
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return db().projects.get(id)
}

export async function saveProjectDoc(id: string, doc: ProjectDoc): Promise<void> {
  await db().projects.update(id, { doc: cloneDoc(doc), updatedAt: Date.now() })
}

export async function renameProject(id: string, name: string): Promise<void> {
  await db().projects.update(id, { name, updatedAt: Date.now() })
}

export async function deleteProject(id: string): Promise<void> {
  await db().transaction('rw', db().projects, db().blobs, async () => {
    await db().blobs.where('projectId').equals(id).delete()
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
