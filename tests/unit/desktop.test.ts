import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopFetch, isDesktop, pickSavePath, writeBlob } from '~/lib/desktop'
import { createOpenAIClient } from '~/lib/llm/client'
import { listModels } from '~/lib/llm/models'

/** Tauri 插件在 node 中没有宿主，替换为记录调用的桩 */
const plugin = vi.hoisted(() => ({
  fetch: vi.fn<(input: URL | Request | string, init?: RequestInit) => Promise<Response>>(),
  save: vi.fn<(options: unknown) => Promise<string | null>>(),
  writeFile: vi.fn<(path: string, data: Uint8Array) => Promise<void>>()
}))

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: plugin.fetch }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: plugin.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: plugin.writeFile }))

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isDesktop', () => {
  afterEach(() => {
    delete (globalThis as { isTauri?: boolean }).isTauri
  })

  it('依据 Tauri 注入的全局标记判定', () => {
    expect(isDesktop()).toBe(false)
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    expect(isDesktop()).toBe(true)
  })
})

describe('desktopFetch', () => {
  it('http(s) 请求交给 Rust 端，data: 等其他协议仍由 WebView 处理', async () => {
    plugin.fetch.mockResolvedValue(new Response('ok'))
    await desktopFetch('https://api.mock.test/v1/models', { method: 'GET' })
    await desktopFetch(new Request('http://127.0.0.1:11434/v1/models'))
    expect(plugin.fetch).toHaveBeenCalledTimes(2)
    expect(plugin.fetch.mock.calls[0]![0]).toBe('https://api.mock.test/v1/models')

    const local = await desktopFetch('data:,hello')
    expect(await local.text()).toBe('hello')
    expect(plugin.fetch).toHaveBeenCalledTimes(2)
  })

  it('桌面版客户端默认经 Rust 端直连目标服务，代理设置不生效', async () => {
    plugin.fetch.mockResolvedValue(json({ object: 'list', data: [{ id: 'b-model', object: 'model' }, { id: 'a-model', object: 'model' }] }))
    const client = createOpenAIClient({ baseURL: 'https://api.mock.test/v1', apiKey: 'test-key', useProxy: true }, { desktop: true })
    expect(await listModels(client)).toEqual(['a-model', 'b-model'])
    const [input, init] = plugin.fetch.mock.calls[0]!
    expect(String(input)).toBe('https://api.mock.test/v1/models')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer test-key')
    expect(headers.has('x-target-base-url')).toBe(false)
  })
})

describe('pickSavePath / writeBlob', () => {
  const filter = { name: 'PNG 图像', extensions: ['png'] }

  it('另存为对话框只预填文件名并限定类型，返回所选路径', async () => {
    plugin.save.mockResolvedValue('D:\\照片\\e2e-edited.png')
    expect(await pickSavePath('e2e-edited.png', filter)).toBe('D:\\照片\\e2e-edited.png')
    expect(plugin.save).toHaveBeenCalledWith({ defaultPath: 'e2e-edited.png', filters: [filter] })
  })

  it('用户取消时返回 null', async () => {
    plugin.save.mockResolvedValue(null)
    expect(await pickSavePath('e2e-edited.png', filter)).toBeNull()
  })

  it('按原始字节写入所选路径', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255])
    await writeBlob('D:\\照片\\e2e-edited.png', new Blob([bytes], { type: 'image/png' }))
    const [path, data] = plugin.writeFile.mock.calls[0]!
    expect(path).toBe('D:\\照片\\e2e-edited.png')
    expect(Array.from(data)).toEqual(Array.from(bytes))
  })

  it('写入失败时向上抛出，交由调用方提示', async () => {
    plugin.writeFile.mockRejectedValue(new Error('拒绝访问'))
    await expect(writeBlob('C:\\Windows\\x.png', new Blob([new Uint8Array([1])]))).rejects.toThrow('拒绝访问')
  })
})
