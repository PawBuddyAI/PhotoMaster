import { isDesktop, openExternal } from '~/lib/desktop'
import {
  authorizeUrl,
  decodeConnectCode,
  DESKTOP_RETURN_URL,
  extractConnectCode,
  purchaseUrl,
  webReturnUrl
} from '~/lib/pawbuddy'
import { useSettingsStore } from '~/stores/settings'

/**
 * PawBuddy 账户的登录、连接、充值与断开。
 * 登录是网页授权：网页版整页跳到 PawBuddy 网站，授权后跳回当前页面；桌面版在系统浏览器打开，授权后经深链回来。
 * 两种方式带回的连接码都由 plugins/pawbuddy.client.ts 交给 connect，网页没有自动跳回时也可以粘贴连接码。
 */
export function usePawBuddy() {
  const settings = useSettingsStore()
  const notify = useNotify()
  const config = useRuntimeConfig()

  /** 已连接时用账户所在的网站，否则用配置的默认网站 */
  const site = computed(() => settings.pawbuddy?.site ?? config.public.pawbuddySite)

  async function login(): Promise<void> {
    const defaultSite = config.public.pawbuddySite
    if (isDesktop()) {
      await openExternal(authorizeUrl(defaultSite, DESKTOP_RETURN_URL))
      return
    }
    globalThis.location.assign(authorizeUrl(defaultSite, webReturnUrl(globalThis.location)))
  }

  /** 用连接码（或带连接码的跳回地址）连接，模型随之换成账户指定的模型；连接码无效时提示并返回 false */
  function connect(text: string): boolean {
    const code = extractConnectCode(text)
    const conn = code ? decodeConnectCode(code) : null
    if (!conn) {
      notify.warning('连接码无效', '请回到 PawBuddy 网站重新授权，或复制完整的连接码')
      return false
    }
    settings.connectPawBuddy(conn)
    notify.success('已连接 PawBuddy 账户', conn.email || undefined)
    return true
  }

  function openPurchase(): Promise<void> {
    return openExternal(purchaseUrl(site.value))
  }

  function disconnect(): void {
    settings.disconnectPawBuddy()
    notify.info('已断开 PawBuddy 账户')
  }

  return { site, login, connect, openPurchase, disconnect }
}
