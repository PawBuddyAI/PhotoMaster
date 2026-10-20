import { isDesktop, listenDeepLinks } from '~/lib/desktop'
import { DESKTOP_RETURN_URL, extractConnectCode } from '~/lib/pawbuddy'

/**
 * 接住 PawBuddy 网站授权后带回的连接码（见 usePawBuddy）。
 * 网页版：网站跳回本页，连接码在地址的 # 片段里；连接后从地址栏去掉，刷新或分享地址都不会再带着 Key。
 * 桌面版：网站跳到 ai-photo-master:// 深链，由 Rust 端的 deep-link 插件转交。
 */
export default defineNuxtPlugin((nuxtApp) => {
  const pawbuddy = usePawBuddy()

  if (isDesktop()) {
    void listenDeepLinks((urls) => {
      const link = urls.find(url => url.startsWith(DESKTOP_RETURN_URL))
      if (link) {
        void pawbuddy.connect(link)
      }
    })
    return
  }

  const code = extractConnectCode(globalThis.location.href)
  if (!code) {
    return
  }
  void pawbuddy.connect(code)
  // 路由在 app:created 时按带片段的初始地址再导航一次，要等它之后再清掉片段
  const router = useRouter()
  nuxtApp.hooks.hookOnce('app:mounted', () => {
    const { path, query } = router.currentRoute.value
    void router.replace({ path, query, hash: '' })
  })
})
