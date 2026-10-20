import { describe, expect, it, vi } from 'vitest'
import { keepsNativeContextMenu, suppressNativeContextMenu } from '~/lib/context-menu'

/**
 * 只实现 closest 的元素替身：选择器列表里有一项命中，就当作自己或祖先是这种控件。
 * part 是选择器列表中的一项，例如 input[type="password"]
 */
function elementMatching(match: (part: string) => boolean) {
  return { closest: (selector: string) => selector.split(',').map(part => part.trim()).some(match) ? {} : null }
}

const collapsed = { isCollapsed: true }

describe('keepsNativeContextMenu', () => {
  it('能输入文字的控件里保留系统菜单（剪切、复制、粘贴）', () => {
    for (const part of ['textarea', 'input:not([type])', 'input[type="text"]', 'input[type="password"]', 'input[type="search"]', '[contenteditable]:not([contenteditable="false"])']) {
      expect(keepsNativeContextMenu(elementMatching(p => p === part) as unknown as Element, collapsed), part).toBe(true)
    }
  })

  it('滑块、复选框、普通元素和非元素目标上不保留', () => {
    for (const part of ['input[type="range"]', 'input[type="checkbox"]', 'button']) {
      expect(keepsNativeContextMenu(elementMatching(p => p === part) as unknown as Element, collapsed), part).toBe(false)
    }
    expect(keepsNativeContextMenu(elementMatching(() => false) as unknown as Element, collapsed)).toBe(false)
    expect(keepsNativeContextMenu(null, null)).toBe(false)
    expect(keepsNativeContextMenu(new EventTarget(), collapsed)).toBe(false)
  })

  it('页面上有选中的文字时保留（菜单里有「复制」）', () => {
    expect(keepsNativeContextMenu(elementMatching(() => false) as unknown as Element, { isCollapsed: false })).toBe(true)
  })
})

describe('suppressNativeContextMenu', () => {
  function setup(selection: { isCollapsed: boolean } | null) {
    let listener: ((event: Event) => void) | undefined
    const win = {
      addEventListener: vi.fn((_type: string, handler: (event: Event) => void) => {
        listener = handler
      }),
      removeEventListener: vi.fn(),
      getSelection: () => selection
    }
    const off = suppressNativeContextMenu(win as unknown as Window)
    /** 派发一次右键，返回是否阻止了自带菜单 */
    const fire = (target: unknown) => {
      const preventDefault = vi.fn()
      listener!({ target, preventDefault } as unknown as Event)
      return preventDefault.mock.calls.length > 0
    }
    return { win, off, fire }
  }

  it('没有应用菜单的位置阻止自带菜单，输入框里与选中文字时保留', () => {
    const { win, fire } = setup(collapsed)
    expect(win.addEventListener).toHaveBeenCalledWith('contextmenu', expect.any(Function))
    expect(fire(elementMatching(() => false))).toBe(true)
    expect(fire(elementMatching(part => part === 'textarea'))).toBe(false)

    expect(setup({ isCollapsed: false }).fire(elementMatching(() => false))).toBe(false)
  })

  it('返回的函数移除同一个监听', () => {
    const { win, off } = setup(collapsed)
    off()
    expect(win.removeEventListener).toHaveBeenCalledWith('contextmenu', win.addEventListener.mock.calls[0]![1])
  })
})
