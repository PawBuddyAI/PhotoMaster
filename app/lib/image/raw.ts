import { RAW_CONVERT_HINT, RawImportError } from './raw-errors'
import { RAW_MAX_BYTES, type RawDecoded } from './raw-settings'

/** 每次导入独立 Worker；成功、失败、取消和超时都会释放 WASM 内存。 */
export async function decodeRaw(file: File, signal?: AbortSignal): Promise<RawDecoded> {
  signal?.throwIfAborted()
  if (!file.size || file.size > RAW_MAX_BYTES) {
    throw new RawImportError(`RAW 文件为空或超过 200 MB，请选择较小的照片，或${RAW_CONVERT_HINT}`)
  }
  const worker = new Worker(new URL('../../workers/raw.worker.ts', import.meta.url), { type: 'module', name: 'raw-import' })
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      finish()
      reject(new DOMException('已取消导入', 'AbortError'))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new RawImportError(`RAW 解码超时，请重试，或${RAW_CONVERT_HINT}`))
    }, 120_000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      finish()
      reject(new RawImportError(`RAW 解码器加载或运行失败，请重试，或${RAW_CONVERT_HINT}`))
    }
    worker.onmessage = ({ data }: MessageEvent<{ result?: RawDecoded, error?: string }>) => {
      finish()
      if (data.result) {
        resolve(data.result)
      } else {
        reject(new RawImportError(data.error || `RAW 解码失败。${RAW_CONVERT_HINT}`))
      }
    }
    worker.postMessage(file)
  })
}
