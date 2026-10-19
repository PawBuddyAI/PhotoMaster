/**
 * 撤销/重做快照栈。调用方在每次修改前 push 修改前的状态；
 * coalesceKey 相同且间隔很短的连续修改（如拖动滑块）只记一次，避免历史被刷屏。
 */
export class HistoryStack<T> {
  private past: T[] = []
  private future: T[] = []
  private lastKey: string | null = null
  private lastTime = 0

  constructor(
    private readonly limit = 100,
    private readonly coalesceMs = 800,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** 记录修改前的状态；返回是否真正入栈 */
  push(state: T, coalesceKey?: string): boolean {
    const time = this.now()
    const merge = coalesceKey !== undefined
      && coalesceKey === this.lastKey
      && time - this.lastTime < this.coalesceMs
      && this.past.length > 0
    this.lastKey = coalesceKey ?? null
    this.lastTime = time
    if (merge) {
      return false
    }
    this.past.push(state)
    if (this.past.length > this.limit) {
      this.past.shift()
    }
    this.future = []
    return true
  }

  undo(current: T): T | null {
    const prev = this.past.pop()
    if (prev === undefined) {
      return null
    }
    this.future.push(current)
    this.lastKey = null
    return prev
  }

  redo(current: T): T | null {
    const next = this.future.pop()
    if (next === undefined) {
      return null
    }
    this.past.push(current)
    this.lastKey = null
    return next
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  clear(): void {
    this.past = []
    this.future = []
    this.lastKey = null
  }
}
