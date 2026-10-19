import OpenAI from 'openai'
import { PROXY_PATH, PROXY_TARGET_HEADER } from '#shared/proxy'
import { desktopFetch, isDesktop } from '~/lib/desktop'

export interface ConnectionConfig {
  baseURL: string
  apiKey: string
  /** 通过本地 Nitro 代理转发，用于不支持浏览器跨域（CORS）的服务；桌面版不受跨域限制，此项不生效 */
  useProxy: boolean
}

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export function normalizeBaseURL(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  return trimmed || DEFAULT_BASE_URL
}

export interface ClientOptions {
  /** 代理模式下的站点源，默认取当前页面 */
  origin?: string
  /** 自定义 fetch（测试时注入）；不传时桌面版用 desktopFetch，网页版用浏览器 fetch */
  fetch?: typeof fetch
  /** 单次请求超时（毫秒） */
  timeout?: number
  /** 是否按桌面版创建，默认自动检测 */
  desktop?: boolean
}

/**
 * 创建 OpenAI 兼容客户端。
 * 网页版由浏览器直接请求；代理模式下请求发往本站 /api/proxy，真实目标地址放在请求头里由服务端转发。
 * 桌面版没有 Nitro 服务，一律由 Rust 端直连目标服务，代理设置不生效。
 */
export function createOpenAIClient(conn: ConnectionConfig, opts: ClientOptions = {}): OpenAI {
  if (!conn.apiKey.trim()) {
    throw new Error('请先在设置中填写 API Key（无需鉴权的服务可填写任意值）')
  }
  const baseURL = normalizeBaseURL(conn.baseURL)
  const origin = opts.origin ?? globalThis.location?.origin ?? ''
  const desktop = opts.desktop ?? isDesktop()
  const viaProxy = conn.useProxy && !desktop
  return new OpenAI({
    apiKey: conn.apiKey.trim(),
    baseURL: viaProxy ? `${origin}${PROXY_PATH}` : baseURL,
    defaultHeaders: viaProxy ? { [PROXY_TARGET_HEADER]: baseURL } : undefined,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    timeout: opts.timeout ?? 10 * 60 * 1000,
    fetch: opts.fetch ?? (desktop ? desktopFetch : undefined)
  })
}
