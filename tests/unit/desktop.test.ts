import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askWarning, desktopFetch, guardWindowClose, isDesktop, keepsNativeContextMenu, pickSavePath, suppressNativeContextMenu, writeBlob } from '~/lib/desktop'
import { createOpenAIClient } from '~/lib/llm/client'
import { listModels } from '~/lib/llm/models'

/** 关闭请求事件的最小替身：记录是否被阻止 */
interface CloseEvent { preventDefault: () => void }

/** Tauri 插件在 node 中没有宿主，替换为记录调用的桩 */
const plugin = vi.hoisted(() => ({
  fetch: vi.fn<(input: URL | Request | string, init?: RequestInit) => Promise<Response>>(),
  save: vi.fn<(options: unknown) => Promise<string | null>>(),
  ask: vi.fn<(message: string, options: unknown) => Promise<boolean>>(),
  writeFile: vi.fn<(path: string, data: Uint8Array) => Promise<void>>(),
  onCloseRequested: vi.fn<(handler: (event: CloseEvent) => Promise<void>) => Promise<() => void>>()
}))

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: plugin.fetch }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: plugin.save, ask: plugin.ask }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: plugin.writeFile }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: plugin.onCloseRequested }) }))

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

describe('guardWindowClose', () => {
  /** 注册拦截并返回 Tauri 收到关闭请求时会调用的回调；与真实实现一致，回调结束且未阻止时窗口才被销毁 */
  async function register(beforeClose: () => Promise<boolean>) {
    const unlisten = vi.fn()
    plugin.onCloseRequested.mockResolvedValue(unlisten)
    expect(await guardWindowClose(beforeClose)).toBe(unlisten)
    const handler = plugin.onCloseRequested.mock.calls[0]![0]
    return async () => {
      const event = { preventDefault: vi.fn() }
      await handler(event)
      return event.preventDefault.mock.calls.length > 0 ? 'kept' : 'closed'
    }
  }

  it('beforeClose 允许时照常关闭，拒绝时保持窗口打开', async () => {
    let allow = true
    const requestClose = await register(async () => allow)
    expect(await requestClose()).toBe('closed')
    allow = false
    expect(await requestClose()).toBe('kept')
  })

  it('beforeClose 出错时仍然关闭，不让窗口关不掉', async () => {
    const requestClose = await register(async () => {
      throw new Error('意外错误')
    })
    expect(await requestClose()).toBe('closed')
  })

  it('处理期间再次请求关闭：保持打开，由正在进行的那次决定，之后的请求照常处理', async () => {
    let finish!: (allow: boolean) => void
    const beforeClose = vi.fn(() => new Promise<boolean>((resolve) => {
      finish = resolve
    }))
    const requestClose = await register(beforeClose)
    const first = requestClose()
    expect(await requestClose()).toBe('kept')
    expect(beforeClose).toHaveBeenCalledTimes(1)
    finish(true)
    expect(await first).toBe('closed')

    const third = requestClose()
    expect(beforeClose).toHaveBeenCalledTimes(2)
    finish(false)
    expect(await third).toBe('kept')
  })
})

describe('askWarning', () => {
  it('弹出带自定义按钮的警告对话框，返回是否点了确认按钮', async () => {
    plugin.ask.mockResolvedValue(true)
    expect(await askWarning('修改未保存', '关闭后这些修改将丢失。', { ok: '放弃修改并关闭', cancel: '返回编辑' })).toBe(true)
    expect(plugin.ask).toHaveBeenCalledWith('关闭后这些修改将丢失。', {
      title: '修改未保存',
      kind: 'warning',
      okLabel: '放弃修改并关闭',
      cancelLabel: '返回编辑'
    })
  })
})

/**
 * 只实现 closest 的元素替身：选择器列表里有一项命中，就当作自己或祖先是这种控件。
 * part 是选择器列表中的一项，例如 input[type="password"]
 */
function elementMatching(match: (part: string) => boolean) {
  return { closest: (selector: string) => selector.split(',').map(part => part.trim()).some(match) ? {} : null }
}

const collapsed = { isCollapsed: true }

describe('keepsNativeContextMenu', () => {
  it('能输入文字的控件里保留系统菜单（剪切、复制、粘贴）', () => {
    for (const part of ['textarea', 'input:not([type])', 'input[type="text"]', 'input[type="password"]', 'input[type="search"]', '[contenteditable]:not([contenteditable="false"])']) {
      expect(keepsNativeContextMenu(elementMatching(p => p === part) as unknown as Element, collapsed), part).toBe(true)
    }
  })

  it('滑块、复选框、普通元素和非元素目标上不保留', () => {
    for (const part of ['input[type="range"]', 'input[type="checkbox"]', 'button']) {
      expect(keepsNativeContextMenu(elementMatching(p => p === part) as unknown as Element, collapsed), part).toBe(false)
    }
    expect(keepsNativeContextMenu(elementMatching(() => false) as unknown as Element, collapsed)).toBe(false)
    expect(keepsNativeContextMenu(null, null)).toBe(false)
    expect(keepsNativeContextMenu(new EventTarget(), collapsed)).toBe(false)
  })

  it('页面上有选中的文字时保留（菜单里有「复制」）', () => {
    expect(keepsNativeContextMenu(elementMatching(() => false) as unknown as Element, { isCollapsed: false })).toBe(true)
  })
})

describe('suppressNativeContextMenu', () => {
  function setup(selection: { isCollapsed: boolean } | null) {
    let listener: ((event: Event) => void) | undefined
    const win = {
      addEventListener: vi.fn((_type: string, handler: (event: Event) => void) => {
        listener = handler
      }),
      removeEventListener: vi.fn(),
      getSelection: () => selection
    }
    const off = suppressNativeContextMenu(win as unknown as Window)
    /** 派发一次右键，返回是否阻止了默认菜单 */
    const fire = (target: unknown) => {
      const preventDefault = vi.fn()
      listener!({ target, preventDefault } as unknown as Event)
      return preventDefault.mock.calls.length > 0
    }
    return { win, off, fire }
  }

  it('没有应用菜单的位置阻止 WebView 菜单，输入框里与选中文字时保留', () => {
    const { win, fire } = setup(collapsed)
    expect(win.addEventListener).toHaveBeenCalledWith('contextmenu', expect.any(Function))
    expect(fire(elementMatching(() => false))).toBe(true)
    expect(fire(elementMatching(part => part === 'textarea'))).toBe(false)

    expect(setup({ isCollapsed: false }).fire(elementMatching(() => false))).toBe(false)
  })

  it('返回的函数移除同一个监听', () => {
    const { win, off } = setup(collapsed)
    off()
    expect(win.removeEventListener).toHaveBeenCalledWith('contextmenu', win.addEventListener.mock.calls[0]![1])
  })
})
