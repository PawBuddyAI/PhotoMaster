import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { ask, type DialogFilter, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { openUrl } from '@tauri-apps/plugin-opener'

/**
 * 桌面版（Tauri）适配：运行时判定、跨域请求、本地文件保存、窗口关闭拦截、打开外部网页与接收深链。
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

/** 在系统默认浏览器打开网页（需要 opener:allow-open-url）；网页版在新标签页打开 */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) {
    await openUrl(url)
    return
  }
  globalThis.open?.(url, '_blank', 'noopener')
}

/**
 * 接收本应用的深链（ai-photo-master://，见 tauri.conf.json）：由深链启动时的地址立即交给 handler，
 * 运行期间再点深链时，系统新开的实例由 single-instance 插件转交给当前窗口。返回取消监听的函数。
 */
export async function listenDeepLinks(handler: (urls: string[]) => void): Promise<() => void> {
  const unlisten = await onOpenUrl(handler)
  const current = await getCurrent()
  if (current?.length) {
    handler(current)
  }
  return unlisten
}

/** 系统警告对话框，返回用户是否点了 ok 按钮（需要 dialog:allow-message） */
export function askWarning(title: string, message: string, buttons: { ok: string, cancel: string }): Promise<boolean> {
  return ask(message, { title, kind: 'warning', okLabel: buttons.ok, cancelLabel: buttons.cancel })
}
