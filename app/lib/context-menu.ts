/**
 * 拦截浏览器（桌面版是 WebView2）自带的右键菜单：应用只显示自己的右键菜单（工程卡片、侧栏相册、图层、画布），
 * 其余位置的「后退 / 刷新 / 另存为 / 打印 / 检查」与修图无关，「刷新」还会丢掉正在进行的重绘。
 * 能输入文字的控件里和选中了文字时保留系统菜单，剪切、复制、粘贴仍然可用。
 */

/** 能输入文字的控件：这里保留系统的剪切、复制、粘贴菜单 */
const TEXT_FIELD = [
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  'input:not([type])',
  ...['text', 'search', 'url', 'email', 'password', 'number', 'tel'].map(type => `input[type="${type}"]`)
].join(', ')

/** 是否保留自带的右键菜单：右键落在能输入文字的控件里，或页面上有选中的文字（菜单里有「复制」） */
export function keepsNativeContextMenu(target: EventTarget | null, selection: Pick<Selection, 'isCollapsed'> | null): boolean {
  if (selection && !selection.isCollapsed) {
    return true
  }
  return typeof (target as Element | null)?.closest === 'function' && (target as Element).closest(TEXT_FIELD) !== null
}

/**
 * 在窗口上兜底阻止自带的右键菜单。应用自己的右键菜单在触发元素上先处理并阻止默认行为，不受这里影响。
 * 返回取消监听的函数
 */
export function suppressNativeContextMenu(win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'getSelection'>): () => void {
  const onContextMenu = (event: Event) => {
    if (!keepsNativeContextMenu(event.target, win.getSelection())) {
      event.preventDefault()
    }
  }
  win.addEventListener('contextmenu', onContextMenu)
  return () => win.removeEventListener('contextmenu', onContextMenu)
}
