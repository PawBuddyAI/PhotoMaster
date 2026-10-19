/**
 * 退出前补存：自动保存有防抖，页面卸载或窗口关闭时把还在等待的修改立即写入。
 * 只依赖 PendingSave 接口（编辑器 store 直接满足），事件目标由调用方传入，便于在 node 中测试。
 */

/** 持有待保存修改的一方 */
export interface PendingSave {
  readonly hasUnsavedChanges: boolean
  flush: () => Promise<void>
}

/** 页面的可见性来源（document） */
export type VisibilityTarget = EventTarget & { readonly visibilityState: DocumentVisibilityState }

export interface PageHideOptions {
  /** 有未保存修改时触发浏览器的「离开此网站？」确认；桌面版由窗口关闭拦截负责，不需要 */
  confirmLeave: boolean
}

/** 关闭窗口时最多等待保存的时长，超时按失败处理，不能让窗口一直关不掉 */
export const CLOSE_SAVE_TIMEOUT = 5000

/**
 * 页面被隐藏（切走标签页、最小化）或卸载（关闭、刷新）时尽力发起写入。
 * 浏览器不会等异步的 IndexedDB 写入完成，卸载时可能写不完，所以网页版另在 beforeunload 时请求确认。
 * 返回取消监听的函数。
 */
export function flushOnPageHide(saver: PendingSave, win: EventTarget, doc: VisibilityTarget, options: PageHideOptions): () => void {
  const flushQuietly = () => {
    if (saver.hasUnsavedChanges) {
      // 失败已反映在保存状态上（编辑器顶栏显示「保存失败」），这里不重复提示
      void saver.flush().catch(() => {})
    }
  }
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') {
      flushQuietly()
    }
  }
  const onBeforeUnload = (event: Event) => {
    if (saver.hasUnsavedChanges) {
      flushQuietly()
      event.preventDefault()
    }
  }
  win.addEventListener('pagehide', flushQuietly)
  doc.addEventListener('visibilitychange', onVisibilityChange)
  if (options.confirmLeave) {
    win.addEventListener('beforeunload', onBeforeUnload)
  }
  return () => {
    win.removeEventListener('pagehide', flushQuietly)
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    win.removeEventListener('beforeunload', onBeforeUnload)
  }
}

/**
 * 处理一次窗口关闭请求，返回是否允许关闭：没有待保存修改或补存成功时允许；
 * 保存失败或超过 timeout 仍未完成时，把原因交给 confirmDiscard，由用户决定放弃修改关闭还是返回编辑。
 */
export async function saveBeforeClose(
  saver: PendingSave,
  confirmDiscard: (error: unknown) => Promise<boolean>,
  timeout = CLOSE_SAVE_TIMEOUT
): Promise<boolean> {
  if (!saver.hasUnsavedChanges) {
    return true
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`保存在 ${timeout / 1000} 秒内没有完成`)), timeout)
  })
  try {
    await Promise.race([saver.flush(), timedOut])
    return true
  } catch (err) {
    return await confirmDiscard(err)
  } finally {
    clearTimeout(timer)
  }
}
