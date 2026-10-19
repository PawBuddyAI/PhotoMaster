import { isTauri } from '@tauri-apps/api/core'
import { type DialogFilter, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

/**
 * 桌面版（Tauri）适配：运行时判定、跨域请求与本地文件保存。
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
