import { describeError } from '~/lib/llm/errors'

/**
 * 统一的消息提示：错误经过 describeError 转为中文说明，用户主动取消的操作不提示。
 * 网页版连不上服务且站点提供了桌面版时，错误条带「下载桌面版」按钮，停留得久一些以便点到
 */
export function useNotify() {
  const toast = useToast()
  const { download } = useDesktopRelease()
  const balanceDialog = useBalanceDialog()

  function error(err: unknown): void {
    const friendly = describeError(err)
    if (friendly.aborted) {
      return
    }
    if (friendly.insufficientBalance) {
      balanceDialog.value = true
      return
    }
    const offerDesktop = friendly.suggestDesktop && download.value
    toast.add({
      title: friendly.title,
      description: friendly.description,
      color: 'error',
      icon: 'i-lucide-circle-alert',
      ...(offerDesktop && {
        duration: 12_000,
        actions: [{
          label: '下载桌面版',
          icon: 'i-lucide-download',
          color: 'neutral',
          variant: 'outline',
          size: 'lg',
          href: offerDesktop.url,
          download: true
        }]
      })
    })
  }

  function success(title: string, description?: string): void {
    toast.add({ title, description, color: 'success', icon: 'i-lucide-circle-check' })
  }

  function info(title: string, description?: string): void {
    toast.add({ title, description, color: 'info', icon: 'i-lucide-info' })
  }

  function warning(title: string, description?: string): void {
    toast.add({ title, description, color: 'warning', icon: 'i-lucide-triangle-alert' })
  }

  return { error, success, info, warning }
}
