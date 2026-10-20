/**
 * 图库里工程的排列：三种自动排序，外加手动排序。
 * 手动顺序存在工程的 order 上（整数，越小越靠前），整个图库共用一条顺序，相册里看到的是它的子序列。
 * 本模块只处理排列规则，不碰存储和界面。
 */

export type SortMode = 'recent' | 'created' | 'name' | 'manual'

export const SORT_MODES: ReadonlyArray<{ value: SortMode, label: string, icon: string }> = [
  { value: 'recent', label: '最近修改', icon: 'i-lucide-clock' },
  { value: 'created', label: '创建时间', icon: 'i-lucide-calendar' },
  { value: 'name', label: '名称', icon: 'i-lucide-arrow-down-a-z' },
  { value: 'manual', label: '手动排序', icon: 'i-lucide-grip' }
]

export function isSortMode(value: unknown): value is SortMode {
  return SORT_MODES.some(mode => mode.value === value)
}

export interface Orderable {
  id: string
  order?: number
}

interface Sortable extends Orderable {
  name: string
  createdAt: number
}

export type DropSide = 'before' | 'after'

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/**
 * 每个工程在手动顺序里的位置。传入的列表须按最近修改倒序。
 * 没有 order 的工程排在所有有 order 的工程之前、彼此保持传入顺序，所以给它们补上比最小值更小的连续整数
 */
export function manualValues(projects: readonly Orderable[]): Map<string, number> {
  const values = new Map<string, number>()
  const fresh: string[] = []
  let first = Infinity
  for (const { id, order } of projects) {
    if (order === undefined) {
      fresh.push(id)
    } else {
      values.set(id, order)
      first = Math.min(first, order)
    }
  }
  const base = Number.isFinite(first) ? first : 0
  fresh.forEach((id, i) => values.set(id, base - fresh.length + i))
  return values
}

/** 按手动顺序排列，传入的列表须按最近修改倒序 */
export function manualSequence<T extends Orderable>(projects: readonly T[]): T[] {
  const values = manualValues(projects)
  return projects
    .map((project, index) => ({ project, index }))
    .sort((a, b) => values.get(a.project.id)! - values.get(b.project.id)! || a.index - b.index)
    .map(({ project }) => project)
}

/** 传入的列表须按最近修改倒序；名称、创建时间相同的工程保持这个顺序 */
export function sortProjects<T extends Sortable>(projects: readonly T[], mode: SortMode): T[] {
  switch (mode) {
    case 'recent':
      return [...projects]
    case 'created':
      return [...projects].sort((a, b) => b.createdAt - a.createdAt)
    case 'name':
      return [...projects].sort((a, b) => nameCollator.compare(a.name, b.name))
    case 'manual':
      return manualSequence(projects)
  }
}

/**
 * 把 movedId 放到 targetId 的前面或后面，返回需要写入的 order（工程 id → order），没有变化时返回空表。
 *
 * shown 是界面上此刻看到的顺序（图库页是全部工程，相册页是该相册的工程），可以来自任何一种排序：
 * 看到的顺序就是移动之后的手动顺序。范围内的工程把各自占着的位置按新顺序重新分配，
 * 范围外的工程不动；因此每次只会改动被移过的那一段，而不是整个图库。
 * all 是全部工程，按最近修改倒序；其中还没有 order 的会一并补上，之后顺序才是确定的。
 */
export function planReorder(all: readonly Orderable[], shown: readonly string[], movedId: string, targetId: string, side: DropSide): Map<string, number> {
  if (movedId === targetId || !shown.includes(movedId) || !shown.includes(targetId)) {
    return new Map()
  }
  const rest = shown.filter(id => id !== movedId)
  const at = rest.indexOf(targetId) + (side === 'after' ? 1 : 0)
  const next = [...rest.slice(0, at), movedId, ...rest.slice(at)]
  if (next.every((id, i) => id === shown[i])) {
    return new Map()
  }

  const values = manualValues(all)
  const slots = shown.map(id => values.get(id)!).sort((a, b) => a - b)
  const plan = new Map<string, number>()
  for (const { id, order } of all) {
    if (order === undefined) {
      plan.set(id, values.get(id)!)
    }
  }
  next.forEach((id, i) => {
    if (values.get(id) !== slots[i]) {
      plan.set(id, slots[i]!)
    }
  })
  return plan
}
