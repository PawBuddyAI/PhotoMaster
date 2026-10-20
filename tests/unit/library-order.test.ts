import { describe, expect, it } from 'vitest'
import { manualSequence, manualValues, planReorder, sortProjects } from '~/lib/library/order'

interface Item {
  id: string
  name: string
  createdAt: number
  order?: number
}

/** 传入顺序即最近修改倒序 */
const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, name: id, createdAt: 0, ...extra })
const ids = (items: Item[]) => items.map(i => i.id)

describe('manualValues', () => {
  it('没有 order 的工程排在所有有 order 的工程之前，彼此保持传入顺序', () => {
    const values = manualValues([item('n1'), item('a', { order: 3 }), item('n2'), item('b', { order: 5 })])

    expect([...values]).toEqual([['a', 3], ['b', 5], ['n1', 1], ['n2', 2]])
    expect(values.get('n1')! < values.get('a')!).toBe(true)
  })

  it('全部没有 order 时从负数补起，保持传入顺序；空列表没有值', () => {
    expect([...manualValues([item('x'), item('y'), item('z')])]).toEqual([['x', -3], ['y', -2], ['z', -1]])
    expect(manualValues([]).size).toBe(0)
  })

  it('order 可以是 0 或负数', () => {
    const values = manualValues([item('n'), item('a', { order: 0 }), item('b', { order: -4 })])

    expect(values.get('n')).toBe(-5)
  })
})

describe('sortProjects', () => {
  const list = [
    item('c', { name: '照片 10', createdAt: 1 }),
    item('a', { name: '照片 2', createdAt: 3 }),
    item('b', { name: 'Beach', createdAt: 2 })
  ]

  it('最近修改保持传入顺序，且不改动传入的数组', () => {
    const copy = [...list]
    expect(ids(sortProjects(list, 'recent'))).toEqual(['c', 'a', 'b'])
    expect(list).toEqual(copy)
  })

  it('创建时间新的在前', () => {
    expect(ids(sortProjects(list, 'created'))).toEqual(['a', 'b', 'c'])
  })

  it('名称按中文排序规则与数字大小排：中文在前、英文在后，「照片 2」在「照片 10」前', () => {
    expect(ids(sortProjects(list, 'name'))).toEqual(['a', 'c', 'b'])
  })

  it('名称相同的工程保持最近修改的顺序', () => {
    const same = [item('x', { name: '同名' }), item('y', { name: '同名' }), item('z', { name: '同名' })]

    expect(ids(sortProjects(same, 'name'))).toEqual(['x', 'y', 'z'])
  })

  it('手动排序：新工程在前，其余按 order', () => {
    const manual = [item('new'), item('b', { order: 2 }), item('a', { order: 1 })]

    expect(ids(sortProjects(manual, 'manual'))).toEqual(['new', 'a', 'b'])
    expect(ids(manualSequence(manual))).toEqual(['new', 'a', 'b'])
  })
})

describe('planReorder', () => {
  /** 已排过的图库：显示顺序 a b c d，order 10/20/30/40 */
  const ordered = () => [item('a', { order: 10 }), item('b', { order: 20 }), item('c', { order: 30 }), item('d', { order: 40 })]
  const shownOf = (all: Item[]) => ids(manualSequence(all))

  /** 把计划应用到工程上，得到新的手动顺序 */
  function apply(all: Item[], plan: Map<string, number>): string[] {
    return shownOf(all.map(i => plan.has(i.id) ? { ...i, order: plan.get(i.id) } : i))
  }

  it('往前移：只改被移过的那一段，其余不动', () => {
    const all = ordered()
    const plan = planReorder(all, shownOf(all), 'd', 'b', 'before')

    expect(Object.fromEntries(plan)).toEqual({ b: 30, c: 40, d: 20 })
    expect(apply(all, plan)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('往后移到某张之后', () => {
    const all = ordered()
    const plan = planReorder(all, shownOf(all), 'a', 'c', 'after')

    expect(Object.fromEntries(plan)).toEqual({ a: 30, b: 10, c: 20 })
    expect(apply(all, plan)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('移到最前与最后', () => {
    const all = ordered()

    expect(apply(all, planReorder(all, shownOf(all), 'c', 'a', 'before'))).toEqual(['c', 'a', 'b', 'd'])
    expect(apply(all, planReorder(all, shownOf(all), 'b', 'd', 'after'))).toEqual(['a', 'c', 'd', 'b'])
  })

  it('放回原位（自己上、紧邻的缝隙里）什么都不写', () => {
    const all = ordered()
    const shown = shownOf(all)

    expect(planReorder(all, shown, 'b', 'b', 'before').size).toBe(0)
    expect(planReorder(all, shown, 'b', 'a', 'after').size).toBe(0)
    expect(planReorder(all, shown, 'b', 'c', 'before').size).toBe(0)
  })

  it('目标或被拖的工程不在当前页面里时不动', () => {
    const all = ordered()

    expect(planReorder(all, ['a', 'b'], 'a', 'd', 'after').size).toBe(0)
    expect(planReorder(all, ['a', 'b'], 'x', 'b', 'after').size).toBe(0)
  })

  it('还没排过的工程一并补上 order，整个图库的顺序随之确定', () => {
    const all = [item('n1'), item('n2'), item('n3')]
    const plan = planReorder(all, ids(all), 'n3', 'n1', 'before')

    expect(apply(all, plan)).toEqual(['n3', 'n1', 'n2'])
    expect([...plan.keys()].sort()).toEqual(['n1', 'n2', 'n3'])
  })

  it('排过之后新导入的工程在最前，再次排序时补上比所有已排工程都小的 order', () => {
    const all = [item('new'), ...ordered()]
    const plan = planReorder(all, shownOf(all), 'd', 'new', 'after')

    expect(apply(all, plan)).toEqual(['new', 'd', 'a', 'b', 'c'])
    expect(plan.get('new')).toBe(9)
  })

  it('相册里排序：只在相册的位置里重新分配，相册外的工程不动、相对位置不变', () => {
    // 图库顺序 a b c d e，相册里是 b、d、e
    const all = [...ordered(), item('e', { order: 50 })]
    const plan = planReorder(all, ['b', 'd', 'e'], 'e', 'b', 'before')

    expect(Object.fromEntries(plan)).toEqual({ b: 40, d: 50, e: 20 })
    expect(apply(all, plan)).toEqual(['a', 'e', 'c', 'b', 'd'])
    expect(plan.has('a') || plan.has('c')).toBe(false)
  })

  it('在别的排序方式下拖动：看到的顺序成为手动顺序', () => {
    // 按名称看到的是 b a c；把 c 放到 b 前面，得到 c b a
    const all = [item('a', { order: 1 }), item('b', { order: 2 }), item('c', { order: 3 })]
    const plan = planReorder(all, ['b', 'a', 'c'], 'c', 'b', 'before')

    expect(apply(all, plan)).toEqual(['c', 'b', 'a'])
  })
})
