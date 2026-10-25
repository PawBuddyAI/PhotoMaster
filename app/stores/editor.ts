import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowRef } from 'vue'
import { type AdjustParamKey, defaultAdjustParams } from '~/lib/adjust/params'
import { constrainCrop } from '~/lib/geometry/crop'
import { HistoryStack } from '~/lib/history'
import {
  cloneDoc,
  createAdjustmentLayer,
  createGenerativeLayer,
  emptyDoc,
  layerFromAdjustmentSuggestion,
  layerFromGenerativeSuggestion,
  moveLayerInList,
  nextLayerName,
  normalizeDoc,
  type AdjustmentLayerInit,
  type GenerativeLayerInit
} from '~/lib/project/doc'
import { normalizeRawDevelop, type RawDevelop, type RawProfile } from '~/lib/image/raw-develop'
import { collectGarbage, getProject, renameProject, saveProjectDoc, setProjectFilePath, setProjectRawProfile } from '~/lib/storage/db'
import type {
  AnalysisResult,
  BrushStroke,
  CropSpec,
  GenerativeResult,
  Layer,
  MaskSpec,
  ProjectDoc,
  ProjectRecord
} from '~/lib/types'

export type EditorTool = 'move' | 'brush' | 'erase' | 'crop'

export type ProjectMeta = Pick<ProjectRecord, 'id' | 'name' | 'width' | 'height' | 'originalBlobId' | 'originalType' | 'thumbnail' | 'filePath' | 'linearBlobId'> & {
  /** 保留了 RAW 原件（可从原件读取 EXIF、补算分析结果） */
  raw: boolean
  /** RAW 分析结果；旧工程在打开「RAW 基础」时补算 */
  rawProfile?: RawProfile
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/** 图层列表底部固定的「RAW 基础」项；选中它时检查器显示风格与降噪 */
export const RAW_BASE_ID = 'raw-base'

const SAVE_DELAY = 600

/**
 * 当前编辑会话：工程文档、选中状态、工具状态、撤销重做与自动保存。
 * 所有文档修改都经过 commit，保证每次修改前都留有历史快照。
 */
export const useEditorStore = defineStore('editor', () => {
  const project = shallowRef<ProjectMeta | null>(null)
  const doc = ref<ProjectDoc>(emptyDoc())
  const selectedLayerId = ref<string | null>(null)
  const tool = ref<EditorTool>('move')
  const brush = reactive({ radius: 0.03, hardness: 0.5 })
  /** 裁剪框锁定的输出长宽比，null 为自由比例 */
  const cropAspect = ref<number | null>(null)
  const showMaskOverlay = ref(true)
  const compareOriginal = ref(false)
  /** 悬停建议时在画布上提示的区域 */
  const hoverMask = ref<MaskSpec | null>(null)
  const saveState = ref<SaveState>('saved')
  const history = markRaw(new HistoryStack<ProjectDoc>())
  const historyTick = ref(0)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 每次修改递增；保存完成时版本已变，说明保存期间又有修改，不能标记为已保存 */
  let revision = 0
  /** 正在进行的写入，保证同一时刻只有一次保存 */
  let saving: Promise<void> | null = null

  const layers = computed(() => doc.value.layers)
  /** 有修改尚未写入（防抖等待中、保存中或上次保存失败），退出前需要补存 */
  const hasUnsavedChanges = computed(() => saveState.value !== 'saved')
  const selectedLayer = computed<Layer | null>(() => layers.value.find(l => l.id === selectedLayerId.value) ?? null)
  const canUndo = computed(() => historyTick.value >= 0 && history.canUndo)
  const canRedo = computed(() => historyTick.value >= 0 && history.canRedo)

  async function open(id: string): Promise<void> {
    await flush()
    const record = await getProject(id)
    if (!record) {
      throw new Error('工程不存在或已被删除')
    }
    project.value = {
      id: record.id,
      name: record.name,
      width: record.width,
      height: record.height,
      originalBlobId: record.originalBlobId,
      linearBlobId: record.linearBlobId,
      originalType: record.originalType,
      thumbnail: record.thumbnail,
      filePath: record.filePath,
      raw: !!record.rawSource,
      rawProfile: record.rawSource?.profile
    }
    doc.value = normalizeDoc(record.doc)
    history.clear()
    historyTick.value++
    selectedLayerId.value = doc.value.layers[0]?.id ?? null
    tool.value = 'move'
    compareOriginal.value = false
    hoverMask.value = null
    saveState.value = 'saved'
    await collectGarbage(record.id, record.originalBlobId, doc.value)
  }

  async function close(): Promise<void> {
    await flush()
    project.value = null
    doc.value = emptyDoc()
    selectedLayerId.value = null
    history.clear()
    historyTick.value++
  }

  /** 修改文档：先压入修改前的快照，再执行修改并安排自动保存 */
  function commit(mutator: (doc: ProjectDoc) => void, coalesceKey?: string): void {
    if (history.push(cloneDoc(doc.value), coalesceKey)) {
      historyTick.value++
    }
    mutator(doc.value)
    scheduleSave()
  }

  function undo(): void {
    const prev = history.undo(cloneDoc(doc.value))
    if (prev) {
      restore(prev)
    }
  }

  function redo(): void {
    const next = history.redo(cloneDoc(doc.value))
    if (next) {
      restore(next)
    }
  }

  function restore(state: ProjectDoc): void {
    doc.value = state
    historyTick.value++
    if (selectedLayerId.value && selectedLayerId.value !== RAW_BASE_ID && !state.layers.some(l => l.id === selectedLayerId.value)) {
      selectedLayerId.value = state.layers[0]?.id ?? null
    }
    scheduleSave()
  }

  function findLayer(d: ProjectDoc, id: string): Layer {
    const layer = d.layers.find(l => l.id === id)
    if (!layer) {
      throw new Error('图层不存在')
    }
    return layer
  }

  function addAdjustmentLayer(init: Partial<AdjustmentLayerInit> = {}): string {
    const layer = createAdjustmentLayer({ name: init.name ?? nextLayerName(doc.value.layers, 'adjust'), ...init })
    commit(d => d.layers.push(layer))
    selectedLayerId.value = layer.id
    return layer.id
  }

  function addGenerativeLayer(init: Partial<GenerativeLayerInit> = {}): string {
    const layer = createGenerativeLayer({ name: init.name ?? nextLayerName(doc.value.layers, 'generative'), ...init })
    commit(d => d.layers.push(layer))
    selectedLayerId.value = layer.id
    if (layer.mask.shape === 'none') {
      tool.value = 'brush'
    }
    return layer.id
  }

  function removeLayer(id: string): void {
    commit((d) => {
      d.layers = d.layers.filter(l => l.id !== id)
    })
    if (selectedLayerId.value === id) {
      selectedLayerId.value = doc.value.layers.at(-1)?.id ?? null
    }
  }

  function moveLayer(id: string, delta: number): void {
    const index = doc.value.layers.findIndex(l => l.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= doc.value.layers.length) {
      return
    }
    commit(d => moveLayerInList(d.layers, id, delta))
  }

  function toggleLayer(id: string): void {
    commit((d) => {
      const layer = findLayer(d, id)
      layer.enabled = !layer.enabled
    })
  }

  function renameLayer(id: string, name: string): void {
    commit((d) => {
      findLayer(d, id).name = name.trim() || findLayer(d, id).name
    }, `rename:${id}`)
  }

  function updateParam(id: string, key: AdjustParamKey, value: number): void {
    commit((d) => {
      const layer = findLayer(d, id)
      if (layer.kind === 'adjust') {
        layer.params[key] = value
      }
    }, `param:${id}:${key}`)
  }

  function resetParams(id: string): void {
    commit((d) => {
      const layer = findLayer(d, id)
      if (layer.kind === 'adjust') {
        layer.params = defaultAdjustParams()
      }
    })
  }

  /** 修改区域；连续拖动同一区域时传 coalesceKey 合并为一次历史 */
  function updateMask(id: string, patch: Partial<MaskSpec>, coalesceKey?: string): void {
    commit((d) => {
      const layer = findLayer(d, id)
      layer.mask = { ...layer.mask, ...patch }
    }, coalesceKey)
  }

  function addStroke(id: string, stroke: BrushStroke): void {
    commit((d) => {
      findLayer(d, id).mask.strokes.push(stroke)
    })
  }

  function clearStrokes(id: string): void {
    commit((d) => {
      findLayer(d, id).mask.strokes = []
    })
  }

  function updatePrompt(id: string, prompt: string): void {
    commit((d) => {
      const layer = findLayer(d, id)
      if (layer.kind === 'generative') {
        layer.prompt = prompt
      }
    }, `prompt:${id}`)
  }

  function setGenerativeResult(id: string, result: GenerativeResult | null): void {
    commit((d) => {
      const layer = findLayer(d, id)
      if (layer.kind === 'generative') {
        layer.result = result
      }
    })
  }

  function setCrop(crop: CropSpec | null, coalesceKey?: string): void {
    const meta = project.value
    commit((d) => {
      d.crop = crop && meta ? constrainCrop(crop, meta.width, meta.height) : null
    }, coalesceKey)
  }

  function setAnalysis(result: AnalysisResult): void {
    commit((d) => {
      d.analysis = result
      d.adopted = []
    })
  }

  /** 采纳一条建议：调色/重绘建议生成对应图层，构图建议写入裁剪 */
  function adoptSuggestion(suggestionId: string): void {
    const analysis = doc.value.analysis
    if (!analysis || doc.value.adopted.includes(suggestionId)) {
      return
    }
    const adjustment = analysis.adjustments.find(s => s.id === suggestionId)
    const generative = analysis.generativeEdits.find(s => s.id === suggestionId)
    let newLayer: Layer | null = null
    if (adjustment) {
      newLayer = layerFromAdjustmentSuggestion(adjustment)
    } else if (generative) {
      newLayer = layerFromGenerativeSuggestion(generative)
    }
    const meta = project.value
    commit((d) => {
      if (newLayer) {
        d.layers.push(newLayer)
      } else if (analysis.crop?.id === suggestionId && meta) {
        d.crop = constrainCrop(analysis.crop.crop, meta.width, meta.height)
      }
      d.adopted.push(suggestionId)
    })
    if (newLayer) {
      selectedLayerId.value = newLayer.id
    }
  }

  async function rename(name: string): Promise<void> {
    const meta = project.value
    const trimmed = name.trim()
    if (!meta || !trimmed) {
      return
    }
    await renameProject(meta.id, trimmed)
    project.value = { ...meta, name: trimmed }
  }

  /** 旧工程补算出的 RAW 分析结果写回工程记录（与文档无关，不进撤销历史） */
  async function setRawProfile(profile: RawProfile): Promise<void> {
    const meta = project.value
    if (!meta) {
      return
    }
    await setProjectRawProfile(meta.id, profile)
    if (project.value?.id === meta.id) project.value = { ...project.value, rawProfile: profile }
  }

  /** 记下这张照片对应的磁盘文件，之后「保存」写回这里 */
  async function setFilePath(filePath: string): Promise<void> {
    const meta = project.value
    if (!meta) {
      return
    }
    await setProjectFilePath(meta.id, filePath)
    project.value = { ...meta, filePath }
  }

  function scheduleSave(): void {
    revision++
    saveState.value = 'dirty'
    if (saveTimer) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(() => {
      void flush()
    }, SAVE_DELAY)
  }

  /**
   * 立即写入尚未保存的修改，不再等防抖。已有保存在进行时先等它结束再补存，
   * 因此 resolve 时调用前的所有修改都已落盘；失败时状态记为 error 并抛出。
   */
  async function flush(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    while (saving) {
      await saving.catch(() => {})
    }
    const meta = project.value
    if (!meta || saveState.value === 'saved') {
      return
    }
    saveState.value = 'saving'
    const savingRevision = revision
    const task = saveProjectDoc(meta.id, doc.value)
    saving = task
    try {
      await task
      saveState.value = revision === savingRevision ? 'saved' : 'dirty'
    } catch (err) {
      saveState.value = 'error'
      throw err
    } finally {
      if (saving === task) {
        saving = null
      }
    }
  }

  return {
    project,
    doc,
    layers,
    selectedLayerId,
    selectedLayer,
    tool,
    brush,
    cropAspect,
    showMaskOverlay,
    compareOriginal,
    hoverMask,
    saveState,
    hasUnsavedChanges,
    canUndo,
    canRedo,
    open,
    close,
    undo,
    redo,
    addAdjustmentLayer,
    addGenerativeLayer,
    removeLayer,
    moveLayer,
    toggleLayer,
    renameLayer,
    updateParam,
    resetParams,
    updateMask,
    addStroke,
    clearStrokes,
    updatePrompt,
    setGenerativeResult,
    setCrop,
    setHdr: (hdr: import('../lib/image/hdr').HdrSettings) => commit((d) => { d.hdr = { ...hdr } }),
    /** RAW 基础设置；拖动降噪滑块时传 coalesceKey 合并为一次历史 */
    setRaw: (raw: RawDevelop, coalesceKey?: string) => commit((d) => { d.raw = normalizeRawDevelop(raw) }, coalesceKey),
    setRawProfile,
    setAnalysis,
    adoptSuggestion,
    rename,
    setFilePath,
    flush
  }
})
