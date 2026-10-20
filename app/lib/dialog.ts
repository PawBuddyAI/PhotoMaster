/**
 * 回车留给控件自己处理的元素：其他按钮与链接、多行文本、下拉框与菜单项、可编辑区域，以及已展开弹出层的触发器。
 * 单选项虽然是 button，回车对它没有含义（Reka 会吞掉），所以不在其中
 */
export const ENTER_OWNER_SELECTOR = [
  'button:not([role="radio"])',
  'a[href]',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[aria-expanded="true"]'
].join(', ')

export type EnterKeyEvent = Pick<KeyboardEvent, 'key' | 'keyCode' | 'isComposing' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'target'>

/**
 * 弹窗里的这次按键是否应触发默认的确认按钮：只认不带修饰键、非长按的回车。
 * 输入法组字时的回车用来上屏（Safari 结束组字时 isComposing 已为 false，只能靠 keyCode 229 识别）；
 * 焦点在会自己响应回车的控件上时也不抢
 */
export function shouldConfirmOnEnter(event: EnterKeyEvent): boolean {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) {
    return false
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false
  }
  const target = event.target as Partial<Element> | null
  return !target?.closest?.(ENTER_OWNER_SELECTOR)
}
