import * as Comlink from 'comlink'
import type { ImageWorkerApi } from '~/workers/image.worker'

let remote: Comlink.Remote<ImageWorkerApi> | null = null

/** 图像计算 Worker 的单例代理 */
export function useImageWorker(): Comlink.Remote<ImageWorkerApi> {
  if (!remote) {
    const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module', name: 'image-worker' })
    remote = Comlink.wrap<ImageWorkerApi>(worker)
  }
  return remote
}
