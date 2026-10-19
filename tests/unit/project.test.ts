import { describe, expect, it } from 'vitest'
import { defaultAdjustParams, isIdentityParams, sanitizeAdjustParams } from '~/lib/adjust/params'
import { HistoryStack } from '~/lib/history'
import { createMaskSpec } from '~/lib/mask/spec'
import { buildRenderLayers } from '~/lib/pipeline/layers'
import { gaussianKernel } from '~/lib/pipeline/renderer'
import {
  cloneDoc,
  createAdjustmentLayer,
  createGenerativeLayer,
  emptyDoc,
  moveLayerInList,
  nextLayerName,
  normalizeDoc,
  referencedBlobIds
} from '~/lib/project/doc'

describe('HistoryStack', () => {
  it('撤销与重做', () => {
    const h = new HistoryStack<number>()
    h.push(1)
    h.push(2)
    expect(h.undo(3)).toBe(2)
    expect(h.undo(2)).toBe(1)
    expect(h.undo(1)).toBeNull()
    expect(h.redo(1)).toBe(2)
    expect(h.redo(2)).toBe(3)
    expect(h.canRedo).toBe(false)
  })

  it('相同键的连续修改合并为一条历史，超时后重新记录', () => {
    let now = 0
    const h = new HistoryStack<number>(100, 800, () => now)
    expect(h.push(0, 'slider')).toBe(true)
    now = 100
    expect(h.push(1, 'slider')).toBe(false)
    now = 2000
    expect(h.push(2, 'slider')).toBe(true)
    expect(h.push(3, 'other')).toBe(true)
  })

  it('新的修改清空重做栈，超出上限丢弃最早记录', () => {
    const h = new HistoryStack<number>(3)
    for (let i = 0; i < 5; i++) h.push(i)
    expect(h.undo(5)).toBe(4)
    h.push(9)
    expect(h.canRedo).toBe(false)
    // 上限为 3：最早的 0、1 已被丢弃
    expect(h.undo(10)).toBe(9)
    expect(h.undo(9)).toBe(3)
    expect(h.undo(3)).toBe(2)
    expect(h.undo(2)).toBeNull()
  })
})

describe('工程文档', () => {
  it('图层创建、命名与移动', () => {
    const doc = emptyDoc()
    doc.layers.push(createAdjustmentLayer({ name: nextLayerName(doc.layers, 'adjust') }))
    doc.layers.push(createGenerativeLayer({ name: nextLayerName(doc.layers, 'generative') }))
    doc.layers.push(createAdjustmentLayer({ name: nextLayerName(doc.layers, 'adjust') }))
    expect(doc.layers.map(l => l.name)).toEqual(['调整 1', '重绘 1', '调整 2'])
    const lastId = doc.layers[2]!.id
    expect(moveLayerInList(doc.layers, lastId, -2)).toBe(true)
    expect(doc.layers[0]!.id).toBe(lastId)
    expect(moveLayerInList(doc.layers, lastId, -1)).toBe(false)
  })

  it('深拷贝互不影响，并收集被引用的补丁', () => {
    const doc = emptyDoc()
    const gen = createGenerativeLayer({ name: 'g' })
    gen.result = { blobId: 'b1', x: 0, y: 0, w: 10, h: 10 }
    doc.layers.push(gen)
    const copy = cloneDoc(doc)
    copy.layers[0]!.name = 'changed'
    expect(doc.layers[0]!.name).toBe('g')
    expect([...referencedBlobIds(doc)]).toEqual(['b1'])
  })

  it('补齐旧数据缺失字段', () => {
    const doc = normalizeDoc({ layers: [{ ...createAdjustmentLayer({ name: 'a' }), params: { exposure: 9 } as never }] })
    expect(doc.adopted).toEqual([])
    expect(doc.crop).toBeNull()
    const layer = doc.layers[0]!
    expect(layer.kind === 'adjust' && layer.params.exposure).toBe(5)
  })
})

describe('调整参数', () => {
  it('限幅与恒等判断', () => {
    expect(isIdentityParams(defaultAdjustParams())).toBe(true)
    const p = sanitizeAdjustParams({ exposure: -9, contrast: 'x', sharpen: -5 })
    expect(p.exposure).toBe(-5)
    expect(p.contrast).toBe(0)
    expect(p.sharpen).toBe(0)
  })
})

describe('渲染图层构建', () => {
  const full = { x: 0, y: 0, w: 100, h: 100 }

  it('跳过恒等图层，全图蒙版不栅格化，局部蒙版按内容生成纹理键', () => {
    const exposure = { ...defaultAdjustParams(), exposure: 1 }
    const layers = buildRenderLayers([
      { params: defaultAdjustParams(), mask: createMaskSpec('full') },
      { params: exposure, mask: createMaskSpec('full') },
      { params: exposure, mask: createMaskSpec('rect') },
      { params: exposure, mask: createMaskSpec('none') }
    ], 100, 100, full, 50, 50, 'p')
    expect(layers).toHaveLength(3)
    expect(layers[0]!.mask).toBeNull()
    expect(layers[1]!.mask?.width).toBe(50)
    expect(layers[1]!.mask?.empty).toBe(false)
    expect(layers[2]!.mask?.empty).toBe(true)
    expect(layers[1]!.mask?.key).not.toBe(layers[2]!.mask?.key)
  })

  it('高斯核归一化', () => {
    for (const sigma of [0.5, 1.3, 3, 10]) {
      const { radius, weights } = gaussianKernel(sigma)
      let sum = weights[0]!
      for (let i = 1; i <= radius; i++) sum += 2 * weights[i]!
      expect(sum).toBeCloseTo(1, 5)
    }
  })
})
