import { isDesktop } from '~/lib/desktop'
import { formatInstallerSize, loadSiteRelease, type ReleaseManifest, SITE_INSTALLER_URL } from '~/lib/release'

/**
 * 网页版的桌面版下载入口：站点 /download/ 下有发布清单才有值，侧栏、设置页与连接失败的提示共用同一份。
 * 桌面版自己就是客户端，不请求也不展示；还没发布过桌面版时 download 恒为 null，界面不放打不开的链接。
 * 由 app.vue 在启动时调用 load，整个会话只请求一次。
 */
export function useDesktopRelease() {
  const release = useState<ReleaseManifest | null>('desktop-release', () => null)
  const requested = useState('desktop-release-requested', () => false)

  async function load(): Promise<void> {
    if (requested.value || isDesktop()) {
      return
    }
    requested.value = true
    release.value = await loadSiteRelease()
  }

  const download = computed(() => release.value && {
    url: SITE_INSTALLER_URL,
    version: release.value.version,
    size: formatInstallerSize(release.value.size)
  })

  return { download, load }
}
