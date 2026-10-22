import { desktopFetch, isDesktop } from '~/lib/desktop'
import { normalizeBaseURL, type ConnectionConfig } from '~/lib/llm/client'

/** 与 PawBuddy 客户端一致：网关 /usage 接受 API Key，余额为零时仍可查询。 */
export async function fetchPawBuddyBalance(
  connection: ConnectionConfig,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = isDesktop() ? desktopFetch : globalThis.fetch
): Promise<number> {
  const response = await fetchImpl(`${normalizeBaseURL(connection.baseURL)}/usage`, {
    headers: { Authorization: `Bearer ${connection.apiKey.trim()}` },
    credentials: 'omit',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
  })
  if (!response.ok) {
    throw new Error('暂时无法查询余额，请稍后刷新。你仍可以前往 PawBuddy 充值。')
  }
  const value = await response.json() as { balance?: unknown, remaining?: unknown }
  const balance = typeof value?.balance === 'number' ? value.balance : value?.remaining
  if (typeof balance !== 'number' || !Number.isFinite(balance)) {
    throw new Error('账户服务未返回有效余额，请稍后刷新。')
  }
  return balance
}
