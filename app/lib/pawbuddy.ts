/**
 * PawBuddy 账户：在 PawBuddy 网站的连接页登录并授权后，网站跳回本应用，在跳回地址的 `#code=` 里带上连接码。
 * 连接码里有账户的 sub2api 网关地址与 Key，读图与修图都经这个 OpenAI 兼容网关调用、从账户余额扣费。
 * 连接码与授权页的约定见 PawBuddy 网站的 app/utils/connect.ts：`PB1.` + base64url(JSON)。
 */

/** 本应用在 PawBuddy 网站登记的 id（网站 CONNECT_APPS 中的一项） */
export const PAWBUDDY_APP_ID = 'ai-photo'

/** 桌面版的跳回地址：scheme 与 src-tauri/tauri.conf.json 的 plugins.deep-link 一致 */
export const DESKTOP_RETURN_URL = 'ai-photo-master://connect'

export interface PawBuddyConnection {
  /** OpenAI 兼容网关，形如 https://pawbuddy.chat/v1 */
  gateway: string
  /** PawBuddy 网站：授权页与充值页都在这里 */
  site: string
  user: number
  email: string
  key: string
}

const PREFIX = 'PB1.'

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

/** 解析连接码；格式不对、版本不认识或缺少本应用要用的字段时返回 null */
export function decodeConnectCode(code: string): PawBuddyConnection | null {
  const trimmed = code.trim()
  if (!trimmed.startsWith(PREFIX)) {
    return null
  }
  try {
    const raw = JSON.parse(fromBase64Url(trimmed.slice(PREFIX.length))) as Record<string, unknown>
    const user = Number(raw.user)
    if (
      raw.v !== 1
      || !isHttpUrl(raw.gateway)
      || !isHttpUrl(raw.site)
      || typeof raw.email !== 'string'
      || typeof raw.key !== 'string'
      || !raw.key.trim()
      || !Number.isSafeInteger(user)
      || user <= 0
    ) {
      return null
    }
    return { gateway: raw.gateway, site: raw.site, user, email: raw.email, key: raw.key.trim() }
  } catch {
    return null
  }
}

/**
 * 从粘贴的文本或跳回地址里取出连接码：本身就是连接码，或地址的 `#code=`（网站跳回）、`?code=`（深链）。
 * 取不到时返回 null，是否有效由 decodeConnectCode 判断
 */
export function extractConnectCode(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith(PREFIX)) {
    return trimmed
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  const value = (new URLSearchParams(url.hash.slice(1)).get('code') ?? url.searchParams.get('code'))?.trim()
  return value?.startsWith(PREFIX) ? value : null
}

/** 网站上本应用的授权页：未登录时网站先转到登录或注册，完成后回到这里，用户确认授权后跳回 returnUrl */
export function authorizeUrl(site: string, returnUrl: string): string {
  const url = new URL('/connect', site)
  url.searchParams.set('app', PAWBUDDY_APP_ID)
  url.searchParams.set('return', returnUrl)
  return url.toString()
}

/** 网站的充值页 */
export function purchaseUrl(site: string): string {
  return new URL('/purchase', site).toString()
}

/** 网页版授权后跳回当前页面；查询参数与片段都不带，片段留给网站放连接码 */
export function webReturnUrl(location: Pick<Location, 'origin' | 'pathname'>): string {
  return `${location.origin}${location.pathname}`
}

/**
 * 连上 PawBuddy 账户时固定使用的读图模型、思考等级与修图模型：用户不能改，设置页与向导都不显示这几项，断开账户后才恢复。
 * 模型名与网站模型表（/data/model_pricing.json）中的 id 一致：读图模型在 models 里且能看图，修图模型在 image_models 里
 */
export const PAWBUDDY_PRESET = {
  visionModel: 'deepseek-v4.1-flash',
  reasoningEffort: 'max',
  imageModel: 'image-2.5-sunburst'
} as const
