import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_ACCEPT, IMPORT_EXTENSIONS, isRawFile } from '~/lib/image/import-formats'
import { decodeRaw } from '~/lib/image/raw'

class FakeWorker {
  static last: FakeWorker
  onerror?: () => void
  onmessage?: (event: { data: unknown }) => void
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { FakeWorker.last = this }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const raw = () => new File(['sensor'], 'photo.DNG')

describe('RAW 导入生命周期', () => {
  it('大小写与空 MIME 不影响 RAW 识别，桌面和网页选择器都接受 RAW', () => {
    expect(isRawFile('D:\\照片\\test.CR3')).toBe(true)
    expect(isRawFile('test.arw')).toBe(true)
    expect(isRawFile('test.dng.png')).toBe(false)
    expect(isRawFile('dir.raw/photo.jpg')).toBe(false)
    expect(IMAGE_ACCEPT).toContain('.dng')
    expect(IMPORT_EXTENSIONS).toContain('cr3')
  })

  it('成功后立即释放 Worker', async () => {
    const promise = decodeRaw(raw())
    const result = { blob: new Blob(['png'], { type: 'image/png' }) }
    FakeWorker.last.onmessage?.({ data: { result } })
    expect(await promise).toEqual(result)
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('取消终止解码并清掉超时任务', async () => {
    const controller = new AbortController()
    const promise = decodeRaw(raw(), controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Worker 加载失败能恢复，不会一直显示导入中', async () => {
    const promise = decodeRaw(raw())
    FakeWorker.last.onerror?.()
    await expect(promise).rejects.toThrow('加载或运行失败')
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
  })

  it('解码无响应时超时并释放 Worker', async () => {
    const promise = decodeRaw(raw())
    const assertion = expect(promise).rejects.toThrow('解码超时')
    await vi.advanceTimersByTimeAsync(120_000)
    await assertion
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
  })

  it('空文件和超限文件在分配 Worker 前拒绝', async () => {
    await expect(decodeRaw(new File([], 'empty.dng'))).rejects.toThrow('为空或超过')
    const large = raw()
    Object.defineProperty(large, 'size', { value: 201 * 1024 * 1024 })
    await expect(decodeRaw(large)).rejects.toThrow('为空或超过')
  })
})
