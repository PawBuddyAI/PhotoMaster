import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_ACCEPT, IMPORT_EXTENSIONS, isRawFile } from '~/lib/image/import-formats'
import { decodeRaw } from '~/lib/image/raw'
import { describeRawFailure, RAW_OUT_OF_MEMORY, RawImportError, undecodableReason } from '~/lib/image/raw-errors'
import { RAW_MAX_PIXELS, RAW_MAX_PIXELS_LABEL } from '~/lib/image/raw-settings'
import { describeError } from '~/lib/llm/errors'

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

  it('解码器打不开的适马 X3F 不出现在可选格式里', () => {
    expect(isRawFile('sigma.X3F')).toBe(false)
    expect(IMAGE_ACCEPT).not.toContain('.x3f')
    expect(IMPORT_EXTENSIONS).not.toContain('x3f')
  })

  it('像素上限覆盖 6100 万像素一档，提示里的数字与上限一致', () => {
    // 索尼 α7R IV / V、LibRaw 未裁边的索尼输出、徕卡 M11 / SL3、适马 fp L
    for (const [w, h] of [[9504, 6336], [9600, 6376], [9536, 6336], [9568, 6380]]) {
      expect(w! * h!).toBeLessThanOrEqual(RAW_MAX_PIXELS)
    }
    expect(RAW_MAX_PIXELS_LABEL).toBe(`${RAW_MAX_PIXELS / 10_000} 万像素`)
  })

  it('Worker 给出的具体原因原样显示，标题说明是 RAW 导入失败', async () => {
    const promise = decodeRaw(raw())
    FakeWorker.last.onmessage?.({ data: { error: '这台相机使用四色传感器，暂不支持。' } })
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RawImportError)
    expect(describeError(error)).toEqual({ title: '无法导入这张 RAW', description: '这台相机使用四色传感器，暂不支持。' })
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

describe('RAW 解码失败的原因', () => {
  it('解码器不给错误码时按格式线索推断', () => {
    expect(undecodableReason({ nikon: { NEFCompression: 13 } })).toMatch(/^这张是尼康「高效率」RAW/)
    expect(undecodableReason({ nikon: { NEFCompression: 14 } })).toMatch(/^这张是尼康「高效率」RAW/)
    expect(undecodableReason({ dng_version: 17235968 })).toMatch(/^这张 DNG 用了暂不支持的压缩方式.*JPEG-XL/)
    expect(undecodableReason({ nikon: { NEFCompression: 3 } })).toMatch(/^这张 RAW 用了暂不支持的压缩方式/)
    expect(undecodableReason(undefined)).toMatch(/^这张 RAW 用了暂不支持的压缩方式/)
  })

  it('已知原因原样显示，内存不足单独提示，其余给通用说明', () => {
    expect(describeRawFailure(new RawImportError('读不到这张 RAW 的色彩信息'))).toBe('读不到这张 RAW 的色彩信息')
    expect(describeRawFailure(new RangeError('Array buffer allocation failed'))).toBe(RAW_OUT_OF_MEMORY)
    expect(describeRawFailure(new Error('Aborted(OOM). Build with -sASSERTIONS for more info.'))).toBe(RAW_OUT_OF_MEMORY)
    expect(describeRawFailure(new Error('WebAssembly.Memory.grow(): Maximum memory size exceeded'))).toBe(RAW_OUT_OF_MEMORY)
    // 越界访问是数据或解码器问题，不能误报成内存不足
    expect(describeRawFailure(new Error('memory access out of bounds'))).toMatch(/^无法解码这张 RAW/)
    expect(describeRawFailure('LibRaw disposed')).toMatch(/^无法解码这张 RAW/)
  })
})
