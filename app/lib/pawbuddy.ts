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
  /** PawBuddy 网站：官方模型表与充值页都在这里 */
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

export interface OfficialModels {
  /** 能看图的对话模型，可用于读图 */
  vision: string[]
  /** 生图模型，可用于局部重绘 */
  image: string[]
}

type TableEntry = Record<string, unknown>

function entries(value: unknown): TableEntry[] {
  return Array.isArray(value) ? value.filter((item): item is TableEntry => !!item && typeof item === 'object') : []
}

function listedId(entry: TableEntry): string | null {
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  return id && entry.enabled !== false ? id : null
}

/**
 * 按网站的模型表（/data/model_pricing.json）取官方模型，规则与价格页、PawBuddy 客户端相同：
 * 停用的（enabled: false）与 -1m 长上下文版本不列，同一模型的多个计价档只留一条；
 * models 中 capabilities 含 image 的能看图，image_models 是生图模型。
 */
export function officialModels(table: unknown): OfficialModels {
  const root = (table && typeof table === 'object' ? table : {}) as TableEntry
  const vision = new Set<string>()
  for (const entry of entries(root.models)) {
    const id = listedId(entry)
    const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : []
    if (id && !id.toLowerCase().endsWith('-1m') && capabilities.includes('image')) {
      vision.add(id)
    }
  }
  const image = new Set<string>()
  for (const entry of entries(root.image_models)) {
    const id = listedId(entry)
    if (id) {
      image.add(id)
    }
  }
  return { vision: [...vision], image: [...image] }
}

/** 读取网站的模型表；桌面版传入 desktopFetch（模型表不一定允许跨域） */
export async function fetchOfficialModels(site: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<OfficialModels> {
  const response = await fetchImpl(new URL('/data/model_pricing.json', site).toString(), { signal })
  if (!response.ok) {
    throw new Error(`读取 PawBuddy 模型表失败：HTTP ${response.status}`)
  }
  return officialModels(await response.json())
}

/** 当前模型在官方列表里就保留，否则换成列表里的第一个；列表为空时不变 */
export function pickModel(current: string, options: readonly string[]): string {
  return options.includes(current) || !options.length ? current : options[0]!
}
