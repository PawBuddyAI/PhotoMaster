import { defaultAdjustParams, sanitizeAdjustParams } from '../adjust/params'
import { newId } from '../id'
import { createMaskSpec } from '../mask/spec'
import type {
  AdjustmentLayer,
  AdjustmentSuggestion,
  AdjustParams,
  GenerativeLayer,
  GenerativeSuggestion,
  Layer,
  LayerSource,
  MaskSpec,
  ProjectDoc
} from '../types'

export function emptyDoc(): ProjectDoc {
  return { layers: [], crop: null, analysis: null, adopted: [] }
}

/** 文档是纯 JSON，深拷贝既用于历史快照，也用于剥离响应式代理后写入 IndexedDB */
export function cloneDoc(doc: ProjectDoc): ProjectDoc {
  return JSON.parse(JSON.stringify(doc)) as ProjectDoc
}

/** 补齐旧数据缺失的字段 */
export function normalizeDoc(doc: Partial<ProjectDoc> | undefined): ProjectDoc {
  const base = emptyDoc()
  if (!doc) {
    return base
  }
  return {
    layers: (doc.layers ?? []).map(layer => ({
      ...layer,
      mask: { ...createMaskSpec(layer.mask?.shape ?? 'full'), ...layer.mask },
      ...(layer.kind === 'adjust' ? { params: sanitizeAdjustParams(layer.params ?? {}) } : {})
    }) as Layer),
    crop: doc.crop ?? null,
    analysis: doc.analysis ?? null,
    adopted: doc.adopted ?? []
  }
}

export function nextLayerName(layers: Layer[], kind: Layer['kind']): string {
  const prefix = kind === 'adjust' ? '调整' : '重绘'
  const count = layers.filter(l => l.kind === kind).length
  return `${prefix} ${count + 1}`
}

export interface AdjustmentLayerInit {
  name: string
  params?: AdjustParams
  mask?: MaskSpec
  source?: LayerSource
  reason?: string
}

export function createAdjustmentLayer(init: AdjustmentLayerInit): AdjustmentLayer {
  return {
    id: newId(),
    kind: 'adjust',
    name: init.name,
    enabled: true,
    params: init.params ? { ...init.params } : defaultAdjustParams(),
    mask: init.mask ? structuredCloneMask(init.mask) : createMaskSpec('full'),
    source: init.source ?? 'user',
    ...(init.reason ? { reason: init.reason } : {})
  }
}

export interface GenerativeLayerInit {
  name: string
  prompt?: string
  mask?: MaskSpec
  source?: LayerSource
  reason?: string
}

export function createGenerativeLayer(init: GenerativeLayerInit): GenerativeLayer {
  return {
    id: newId(),
    kind: 'generative',
    name: init.name,
    enabled: true,
    prompt: init.prompt ?? '',
    mask: init.mask ? structuredCloneMask(init.mask) : createMaskSpec('none'),
    source: init.source ?? 'user',
    result: null,
    ...(init.reason ? { reason: init.reason } : {})
  }
}

export function layerFromAdjustmentSuggestion(s: AdjustmentSuggestion): AdjustmentLayer {
  return createAdjustmentLayer({ name: s.title, params: s.params, mask: s.mask, source: 'llm', reason: s.reason })
}

export function layerFromGenerativeSuggestion(s: GenerativeSuggestion): GenerativeLayer {
  return createGenerativeLayer({ name: s.title, prompt: s.prompt, mask: s.mask, source: 'llm', reason: s.reason })
}

/** 文档引用的所有补丁 blob id */
export function referencedBlobIds(doc: ProjectDoc): Set<string> {
  const ids = new Set<string>()
  for (const layer of doc.layers) {
    if (layer.kind === 'generative' && layer.result) {
      ids.add(layer.result.blobId)
    }
  }
  return ids
}

/** 把指定图层在列表中移动 delta 位（越界时不动），返回是否移动 */
export function moveLayerInList(layers: Layer[], id: string, delta: number): boolean {
  const from = layers.findIndex(l => l.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= layers.length) {
    return false
  }
  const [layer] = layers.splice(from, 1)
  layers.splice(to, 0, layer!)
  return true
}

function structuredCloneMask(mask: MaskSpec): MaskSpec {
  return JSON.parse(JSON.stringify(mask)) as MaskSpec
}
