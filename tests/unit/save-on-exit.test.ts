import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneDoc, emptyDoc } from '~/lib/project/doc'
import { flushOnPageHide, type PendingSave, saveBeforeClose, type VisibilityTarget } from '~/lib/project/save-on-exit'
import { setProjectFilePath, type Project } from '~/lib/storage/db'
import type { ProjectDoc } from '~/lib/types'
import { useEditorStore } from '~/stores/editor'

/** node 中没有 IndexedDB：替换存储层，记录每次写入时的文档快照，写入何时完成由测试控制 */
const db = vi.hoisted(() => ({
  saves: [] as Array<{ id: string, doc: ProjectDoc }>,
  /** 为 true 时写入挂起，直到调用 release */
  hold: false,
  pending: [] as Array<{ resolve: () => void, reject: (err: unknown) => void }>,
  failNext: null as Error | null
}))

vi.mock('~/lib/storage/db', () => ({
  getProject: vi.fn(async (id: string): Promise<Project> => ({
    id,
    name: '测试工程',
    createdAt: 0,
    updatedAt: 0,
    width: 1200,
    height: 800,
    originalBlobId: 'blob-original',
    originalType: 'image/jpeg',
    thumbnail: new Blob(),
    doc: emptyDoc()
  })),
  collectGarbage: vi.fn(async () => {}),
  renameProject: vi.fn(async () => {}),
  setProjectFilePath: vi.fn(async () => {}),
  saveProjectDoc: vi.fn((id: string, doc: ProjectDoc) => {
    // 与真实实现一样在调用时同步拷贝文档，之后的修改不影响这次写入
    db.saves.push({ id, doc: cloneDoc(doc) })
    const failure = db.failNext
    db.failNext = null
    if (failure) {
      return Promise.reject(failure)
    }
    if (!db.hold) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => db.pending.push({ resolve, reject }))
  })
}))

/** 让已排队的 Promise 回调全部执行（假计时器下不能靠 setTimeout 等待） */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

/** 放行最早挂起的一次写入 */
async function release(): Promise<void> {
  db.pending.shift()!.resolve()
  await settle()
}

async function openEditor() {
  const editor = useEditorStore()
  await editor.open('p1')
  db.saves.length = 0
  return editor
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  db.saves.length = 0
  db.pending.length = 0
  db.hold = false
  db.failNext = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('编辑器 store 的 flush', () => {
  it('防抖期间有待保存修改；flush 立即写入最新文档，之后计时器不再重复写入', async () => {
    const editor = await openEditor()
    expect(editor.hasUnsavedChanges).toBe(false)
    const layerId = editor.addAdjustmentLayer()
    editor.updateParam(layerId, 'exposure', 0.5)
    expect(editor.saveState).toBe('dirty')
    expect(editor.hasUnsavedChanges).toBe(true)
    expect(db.saves).toHaveLength(0)

    await editor.flush()
    expect(db.saves).toHaveLength(1)
    expect(db.saves[0]!.id).toBe('p1')
    expect(db.saves[0]!.doc.layers[0]).toMatchObject({ id: layerId, params: { exposure: 0.5 } })
    expect(editor.saveState).toBe('saved')
    expect(editor.hasUnsavedChanges).toBe(false)

    await vi.advanceTimersByTimeAsync(2000)
    expect(db.saves).toHaveLength(1)
  })

  it('没有待保存修改时不写入', async () => {
    const editor = await openEditor()
    await editor.flush()
    expect(db.saves).toHaveLength(0)
  })

  it('不调用 flush 时由防抖自动保存', async () => {
    const editor = await openEditor()
    editor.addAdjustmentLayer()
    await vi.advanceTimersByTimeAsync(599)
    expect(db.saves).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(db.saves).toHaveLength(1)
    expect(editor.saveState).toBe('saved')
  })

  it('保存期间又有修改：不会被误标为已保存，flush 等在途写入结束后补存最新文档，写入不并行', async () => {
    const editor = await openEditor()
    db.hold = true
    const layerId = editor.addAdjustmentLayer()
    const first = editor.flush()
    expect(editor.saveState).toBe('saving')
    editor.updateParam(layerId, 'contrast', 0.3)
    const second = editor.flush()
    const third = editor.flush()
    // 第一次写入还没完成：后续 flush 只等待，不发起并行写入
    expect(db.saves).toHaveLength(1)

    await release()
    await first
    expect(editor.saveState).not.toBe('saved')
    expect(db.saves).toHaveLength(2)
    expect(db.saves[1]!.doc.layers[0]).toMatchObject({ params: { contrast: 0.3 } })

    await release()
    await Promise.all([second, third])
    expect(db.saves).toHaveLength(2)
    expect(editor.saveState).toBe('saved')
  })

  it('保存失败时状态为 error 并抛出，再次 flush 会重试', async () => {
    const editor = await openEditor()
    editor.addAdjustmentLayer()
    db.failNext = new Error('磁盘已满')
    await expect(editor.flush()).rejects.toThrow('磁盘已满')
    expect(editor.saveState).toBe('error')
    expect(editor.hasUnsavedChanges).toBe(true)

    await editor.flush()
    expect(db.saves).toHaveLength(2)
    expect(editor.saveState).toBe('saved')
  })
})

/** 用 EventTarget 模拟 window 与 document */
function pageTargets() {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState }) satisfies VisibilityTarget
  const hide = () => {
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
  }
  const beforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    win.dispatchEvent(event)
    return event.defaultPrevented
  }
  return { win, doc, hide, beforeUnload }
}

function fakeSaver(hasUnsavedChanges: boolean, flush: () => Promise<void> = async () => {}) {
  return { hasUnsavedChanges, flush: vi.fn(flush) } satisfies PendingSave
}

describe('flushOnPageHide', () => {
  it('编辑后防抖到期前页面卸载：立即把最新文档写入存储', async () => {
    const editor = await openEditor()
    const { win, doc } = pageTargets()
    flushOnPageHide(editor, win, doc, { confirmLeave: true })
    const layerId = editor.addAdjustmentLayer()

    win.dispatchEvent(new Event('pagehide'))
    // 写入在事件回调里同步发起，不等防抖
    expect(db.saves).toHaveLength(1)
    expect(db.saves[0]!.doc.layers[0]!.id).toBe(layerId)
    await settle()
    expect(editor.saveState).toBe('saved')
  })

  it('有待保存修改时 pagehide 与转入后台都会调用 flush；页面仍可见或没有修改时不调用', () => {
    const saver = fakeSaver(true)
    const { win, doc, hide } = pageTargets()
    flushOnPageHide(saver, win, doc, { confirmLeave: false })
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(saver.flush).not.toHaveBeenCalled()
    hide()
    expect(saver.flush).toHaveBeenCalledTimes(1)
    win.dispatchEvent(new Event('pagehide'))
    expect(saver.flush).toHaveBeenCalledTimes(2)

    const clean = fakeSaver(false)
    const other = pageTargets()
    flushOnPageHide(clean, other.win, other.doc, { confirmLeave: true })
    other.hide()
    other.win.dispatchEvent(new Event('pagehide'))
    expect(other.beforeUnload()).toBe(false)
    expect(clean.flush).not.toHaveBeenCalled()
  })

  it('网页版有未保存修改时 beforeunload 请求离开确认并发起保存；桌面版不拦截', () => {
    const web = fakeSaver(true)
    const page = pageTargets()
    flushOnPageHide(web, page.win, page.doc, { confirmLeave: true })
    expect(page.beforeUnload()).toBe(true)
    expect(web.flush).toHaveBeenCalledTimes(1)

    const desktop = fakeSaver(true)
    const desktopPage = pageTargets()
    flushOnPageHide(desktop, desktopPage.win, desktopPage.doc, { confirmLeave: false })
    expect(desktopPage.beforeUnload()).toBe(false)
    expect(desktop.flush).not.toHaveBeenCalled()
  })

  it('保存失败被吞掉（Vitest 会把未处理的拒绝报为错误）；取消监听后不再响应', async () => {
    const saver = fakeSaver(true, () => Promise.reject(new Error('写入失败')))
    const { win, doc, beforeUnload } = pageTargets()
    const dispose = flushOnPageHide(saver, win, doc, { confirmLeave: true })
    win.dispatchEvent(new Event('pagehide'))
    await settle()

    dispose()
    win.dispatchEvent(new Event('pagehide'))
    expect(beforeUnload()).toBe(false)
    expect(saver.flush).toHaveBeenCalledTimes(1)
  })
})

describe('saveBeforeClose', () => {
  it('没有待保存修改时直接允许关闭', async () => {
    const saver = fakeSaver(false)
    const confirm = vi.fn(async () => false)
    expect(await saveBeforeClose(saver, confirm)).toBe(true)
    expect(saver.flush).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('有待保存修改时先 flush，写入完成后允许关闭', async () => {
    const editor = await openEditor()
    editor.addAdjustmentLayer()
    const confirm = vi.fn(async () => false)
    expect(await saveBeforeClose(editor, confirm)).toBe(true)
    expect(db.saves).toHaveLength(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('保存失败时把原因交给用户决定：放弃修改则关闭，返回编辑则保持打开', async () => {
    const error = new Error('磁盘已满')
    const saver = fakeSaver(true, () => Promise.reject(error))
    const discard = vi.fn(async () => true)
    expect(await saveBeforeClose(saver, discard)).toBe(true)
    expect(discard).toHaveBeenCalledWith(error)

    const keep = vi.fn(async () => false)
    expect(await saveBeforeClose(saver, keep)).toBe(false)
  })

  it('保存超过时限仍未完成时按失败处理，不让窗口一直关不掉', async () => {
    const saver = fakeSaver(true, () => new Promise<void>(() => {}))
    const confirm = vi.fn(async (_err: unknown) => true)
    const result = saveBeforeClose(saver, confirm, 3000)
    await vi.advanceTimersByTimeAsync(2999)
    expect(confirm).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe(true)
    expect(String(confirm.mock.calls[0]![0])).toContain('保存在 3 秒内没有完成')
  })
})

describe('记下照片对应的磁盘文件', () => {
  it('写入存储层并更新当前工程；没有打开工程时什么也不做', async () => {
    const editor = useEditorStore()
    const path = 'D:\\照片\\海边.jpg'
    await editor.setFilePath(path)
    expect(setProjectFilePath).not.toHaveBeenCalled()

    await editor.open('p1')
    expect(editor.project?.filePath).toBeUndefined()
    await editor.setFilePath(path)
    expect(setProjectFilePath).toHaveBeenCalledWith('p1', path)
    expect(editor.project?.filePath).toBe(path)
  })
})
