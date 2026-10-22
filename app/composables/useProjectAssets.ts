import { shallowRef } from 'vue'
import { decodeImage } from '~/lib/image/canvas'
import type { PatchSource } from '~/lib/image/compose'
import { getBlob } from '~/lib/storage/db'
import type { Layer } from '~/lib/types'
import type { LinearImage } from '~/lib/image/high-depth'
import { useImageWorker } from './useImageWorker'

export const PREVIEW_LONG_SIDE = 2048

/**
 * 当前工程的大体积资源（解码后的原图与补丁位图）。
 * 位图不可序列化且占用内存大，因此不放进 Pinia 状态，而是以模块级单例缓存。
 */
const projectId = shallowRef<string | null>(null)
const original = shallowRef<ImageBitmap | null>(null)
const originalBlob = shallowRef<Blob | null>(null)
const linearBlob = shallowRef<Blob | null>(null)
const linearPreview = shallowRef<LinearImage | null>(null)
const patchCache = new Map<string, Promise<ImageBitmap>>()
let loadVersion = 0

async function load(id: string, originalBlobId: string, linearBlobId?: string): Promise<void> {
  if (projectId.value === id && original.value) {
    return
  }
  release()
  const version = loadVersion
  const blob = await getBlob(originalBlobId)
  const master = linearBlobId ? await getBlob(linearBlobId) : null
  const preview = master ? await useImageWorker().linearPreview(master, PREVIEW_LONG_SIDE) : null
  const bitmap = await decodeImage(blob)
  if (version !== loadVersion) {
    bitmap.close()
    throw new DOMException('工程加载已取消', 'AbortError')
  }
  original.value = bitmap
  originalBlob.value = blob
  linearPreview.value = preview
  linearBlob.value = master
  projectId.value = id
}

function release(): void {
  loadVersion++
  original.value?.close()
  original.value = null
  originalBlob.value = null
  linearBlob.value = null
  linearPreview.value = null
  projectId.value = null
  for (const pending of patchCache.values()) {
    pending.then(bitmap => bitmap.close(), () => undefined)
  }
  patchCache.clear()
}

function patchBitmap(blobId: string): Promise<ImageBitmap> {
  let pending = patchCache.get(blobId)
  if (!pending) {
    pending = getBlob(blobId).then(decodeImage)
    pending.catch(() => patchCache.delete(blobId))
    patchCache.set(blobId, pending)
  }
  return pending
}

/** 指定图层列表中已启用、已有结果的生成图层对应的补丁（保持图层顺序） */
async function patchSources(layers: readonly Layer[]): Promise<PatchSource[]> {
  const items = layers.flatMap(layer =>
    layer.kind === 'generative' && layer.enabled && layer.result ? [layer.result] : [])
  return Promise.all(items.map(async r => ({ image: await patchBitmap(r.blobId), x: r.x, y: r.y, w: r.w, h: r.h })))
}

function requireOriginal(): ImageBitmap {
  if (!original.value) {
    throw new Error('原图尚未加载')
  }
  return original.value
}

export function useProjectAssets() {
  return { original, originalBlob, linearBlob, linearPreview, load, release, patchBitmap, patchSources, requireOriginal }
}
