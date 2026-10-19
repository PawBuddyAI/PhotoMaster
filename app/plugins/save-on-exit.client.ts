import { askWarning, guardWindowClose, isDesktop } from '~/lib/desktop'
import { describeError } from '~/lib/llm/errors'
import { flushOnPageHide, saveBeforeClose } from '~/lib/project/save-on-exit'
import { useEditorStore } from '~/stores/editor'

/**
 * 退出前补存编辑器里还在防抖中的修改（自动保存延迟见 stores/editor.ts 的 SAVE_DELAY）。
 * 网页版只能在页面隐藏、卸载时尽力写入，并在有未保存修改时请求离开确认；
 * 桌面版拦截窗口关闭，写入完成后才关，失败或超时由用户决定是否放弃修改。
 */
export default defineNuxtPlugin(() => {
  const editor = useEditorStore()
  const desktop = isDesktop()
  flushOnPageHide(editor, window, document, { confirmLeave: !desktop })
  if (!desktop) {
    return
  }
  const notify = useNotify()
  void guardWindowClose(() => saveBeforeClose(editor, (err) => {
    const { description } = describeError(err)
    return askWarning('修改未保存', `最近的修改没能保存：${description}\n\n关闭后这些修改将丢失。`, {
      ok: '放弃修改并关闭',
      cancel: '返回编辑'
    })
  })).catch(err => notify.error(err))
})
