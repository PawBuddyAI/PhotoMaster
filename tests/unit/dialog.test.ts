import { describe, expect, it } from 'vitest'
import { ENTER_OWNER_SELECTOR, type EnterKeyEvent, shouldConfirmOnEnter } from '~/lib/dialog'

/** 单元测试在 node 中运行，没有 DOM：用只实现 closest 的替身表示焦点元素，owns 表示它是否自己响应回车 */
function target(owns: boolean): EventTarget {
  return { closest: (selector: string) => (owns && selector === ENTER_OWNER_SELECTOR ? {} : null) } as unknown as EventTarget
}

function enter(overrides: Partial<EnterKeyEvent> = {}): EnterKeyEvent {
  return {
    key: 'Enter',
    keyCode: 13,
    isComposing: false,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: target(false),
    ...overrides
  }
}

describe('弹窗回车确认', () => {
  it('焦点在输入框、单选项或弹窗本身时，回车触发确认', () => {
    expect(shouldConfirmOnEnter(enter())).toBe(true)
  })

  it('焦点在其他按钮、多行文本或下拉框上时，回车留给它们', () => {
    expect(shouldConfirmOnEnter(enter({ target: target(true) }))).toBe(false)
  })

  it('没有焦点元素或焦点元素不是 DOM 元素时仍触发确认', () => {
    expect(shouldConfirmOnEnter(enter({ target: null }))).toBe(true)
    expect(shouldConfirmOnEnter(enter({ target: {} as EventTarget }))).toBe(true)
  })

  it('输入法组字中的回车只用于上屏，包括 Safari 结束组字时的 keyCode 229', () => {
    expect(shouldConfirmOnEnter(enter({ isComposing: true }))).toBe(false)
    expect(shouldConfirmOnEnter(enter({ keyCode: 229 }))).toBe(false)
  })

  it('带修饰键、长按重复或不是回车时不触发', () => {
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(shouldConfirmOnEnter(enter({ [modifier]: true }))).toBe(false)
    }
    expect(shouldConfirmOnEnter(enter({ repeat: true }))).toBe(false)
    expect(shouldConfirmOnEnter(enter({ key: ' ', keyCode: 32 }))).toBe(false)
  })
})
