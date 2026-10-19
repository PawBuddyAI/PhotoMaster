import { describeError } from '~/lib/llm/errors'

/** 统一的消息提示：错误经过 describeError 转为中文说明，用户主动取消的操作不提示 */
export function useNotify() {
  const toast = useToast()

  function error(err: unknown): void {
    const friendly = describeError(err)
    if (friendly.aborted) {
      return
    }
    toast.add({ title: friendly.title, description: friendly.description, color: 'error', icon: 'i-lucide-circle-alert' })
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
