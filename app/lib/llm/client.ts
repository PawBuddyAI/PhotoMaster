import OpenAI from 'openai'
import { desktopFetch, isDesktop } from '~/lib/desktop'

export interface ConnectionConfig {
  baseURL: string
  apiKey: string
}

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export function normalizeBaseURL(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  return trimmed || DEFAULT_BASE_URL
}

export interface ClientOptions {
  /** 自定义 fetch（测试时注入）；不传时桌面版用 desktopFetch，网页版用浏览器 fetch */
  fetch?: typeof fetch
  /** 单次请求超时（毫秒） */
  timeout?: number
  /** 是否按桌面版创建，默认自动检测 */
  desktop?: boolean
}

/**
 * 创建 OpenAI 兼容客户端，直接请求配置的服务。
 * 网页版由浏览器发出请求，只能连接允许跨域（CORS）的服务；桌面版经 Rust 端转发，不受跨域限制。
 */
export function createOpenAIClient(conn: ConnectionConfig, opts: ClientOptions = {}): OpenAI {
  if (!conn.apiKey.trim()) {
    throw new Error('请先在设置中填写 API Key（无需鉴权的服务可填写任意值）')
  }
  const desktop = opts.desktop ?? isDesktop()
  return new OpenAI({
    apiKey: conn.apiKey.trim(),
    baseURL: normalizeBaseURL(conn.baseURL),
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    timeout: opts.timeout ?? 10 * 60 * 1000,
    fetch: opts.fetch ?? (desktop ? desktopFetch : undefined)
  })
}
