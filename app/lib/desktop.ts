import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, type DialogFilter, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

/**
 * 桌面版（Tauri）适配：运行时判定、跨域请求、本地文件保存、窗口关闭拦截与 WebView 自带右键菜单的屏蔽。
 * 网页版不会调用这些插件；Worker 与 node 测试中 isDesktop() 恒为 false。
 * 插件权限见 src-tauri/capabilities/default.json。
 */

export type { DialogFilter }

/** 是否运行在 Tauri 桌面应用中 */
export function isDesktop(): boolean {
  return isTauri()
}

/**
 * 桌面版的 fetch：http(s) 请求由 Rust 端发出，不受 WebView 跨域（CORS）限制。
 * 其他协议（如 openai SDK 探测 FormData 支持时请求的 data: 地址）不涉及跨域，仍交给 WebView。
 */
export const desktopFetch: typeof fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input)
  return /^https?:/i.test(url) ? tauriFetch(input, init) : fetch(input, init)
}

/**
 * 弹出系统「另存为」对话框，返回所选路径，用户取消时返回 null。
 * 只给文件名不给目录，Windows 会打开上次保存时所在的文件夹；所选路径由对话框插件授予写入权限。
 */
export function pickSavePath(fileName: string, filter: DialogFilter): Promise<string | null> {
  return save({ defaultPath: fileName, filters: [filter] })
}

/** 把 Blob 写入对话框选定的路径，已有文件会被覆盖 */
export async function writeBlob(path: string, blob: Blob): Promise<void> {
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
}

/**
 * 拦截主窗口关闭（标题栏关闭按钮、Alt+F4、任务栏关闭）：beforeClose 返回 false 时保持窗口打开。
 * 前端注册监听后 Tauri 不再自行关窗，而是在回调结束后由前端 destroy（需要 core:window:allow-destroy）。
 * beforeClose 出错时照常关闭；处理期间再次请求关闭会被忽略，由正在进行的那次决定。返回取消监听的函数。
 */
export function guardWindowClose(beforeClose: () => Promise<boolean>): Promise<() => void> {
  let pending = false
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (pending) {
      event.preventDefault()
      return
    }
    pending = true
    try {
      if (!await beforeClose()) {
        event.preventDefault()
      }
    } catch {
      // 拦截逻辑本身出错时放行，不能让窗口关不掉
    } finally {
      pending = false
    }
  })
}

/** 能输入文字的控件：桌面版在这里保留 WebView 自带的剪切、复制、粘贴菜单 */
const TEXT_FIELD = [
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  'input:not([type])',
  ...['text', 'search', 'url', 'email', 'password', 'number', 'tel'].map(type => `input[type="${type}"]`)
].join(', ')

/** 是否保留 WebView 自带的右键菜单：右键落在能输入文字的控件里，或页面上有选中的文字（菜单里有「复制」） */
export function keepsNativeContextMenu(target: EventTarget | null, selection: Pick<Selection, 'isCollapsed'> | null): boolean {
  if (selection && !selection.isCollapsed) {
    return true
  }
  return typeof (target as Element | null)?.closest === 'function' && (target as Element).closest(TEXT_FIELD) !== null
}

/**
 * 不弹出 WebView2 自带的右键菜单（后退、刷新、另存为、打印、检查）：这些是浏览器的操作，出现在桌面应用里既陌生，
 * 「刷新」还会丢掉正在进行的重绘。应用自己的右键菜单在触发元素上先处理并阻止默认行为，这里只兜底其余位置；
 * 输入框与选中文字处保留系统菜单。返回取消监听的函数。
 */
export function suppressNativeContextMenu(win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'getSelection'>): () => void {
  const onContextMenu = (event: Event) => {
    if (!keepsNativeContextMenu(event.target, win.getSelection())) {
      event.preventDefault()
    }
  }
  win.addEventListener('contextmenu', onContextMenu)
  return () => win.removeEventListener('contextmenu', onContextMenu)
}

/** 系统警告对话框，返回用户是否点了 ok 按钮（需要 dialog:allow-message） */
export function askWarning(title: string, message: string, buttons: { ok: string, cancel: string }): Promise<boolean> {
  return ask(message, { title, kind: 'warning', okLabel: buttons.ok, cancelLabel: buttons.cancel })
}
