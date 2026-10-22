/**
 * 工程数据模型。所有坐标若无特别说明均为归一化坐标（0–1，相对原图宽高），
 * 这样同一份数据可以在预览分辨率、全分辨率和 OpenAI 编辑分辨率之间复用。
 */

/** 归一化矩形 */
export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

/** 归一化线段 */
export interface NormLine {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 原图像素坐标中的矩形 */
export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 区域形状：
 * - full：全图
 * - none：空（仅由画笔决定）
 * - rect / ellipse：外接框为 rect，边缘按 feather 向内羽化（椭圆 + 大羽化即径向渐变）
 * - linear：沿 line 从起点（效果 100%）渐变到终点（效果 0%）
 */
export type MaskShape = 'full' | 'none' | 'rect' | 'ellipse' | 'linear'

export interface BrushStroke {
  mode: 'add' | 'erase'
  /** 笔刷半径，相对原图长边 */
  radius: number
  /** 硬度 0–1：1 为硬边，0 为从中心到边缘完全柔化 */
  hardness: number
  /** 点序列 [x0, y0, x1, y1, ...]，归一化坐标 */
  points: number[]
}

export interface MaskSpec {
  shape: MaskShape
  rect: NormRect
  line: NormLine
  /** 羽化宽度占形状半短边的比例（rect / ellipse 有效），0–1 */
  feather: number
  /** 只反转形状部分，画笔笔画始终按其模式叠加 */
  invert: boolean
  /** 整体强度 0–1 */
  density: number
  strokes: BrushStroke[]
}

/** 调色参数，0 表示不调整 */
export interface AdjustParams {
  /** 曝光（EV） */
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  vibrance: number
  saturation: number
  clarity: number
  sharpen: number
}

export type LayerSource = 'llm' | 'user'

interface LayerBase {
  id: string
  name: string
  enabled: boolean
  mask: MaskSpec
  source: LayerSource
  /** 来自 LLM 建议时附带的理由 */
  reason?: string
}

export interface AdjustmentLayer extends LayerBase {
  kind: 'adjust'
  params: AdjustParams
}

/** 生成式重绘的结果补丁：RGBA PNG，alpha 为羽化蒙版，位置为原图像素坐标 */
export interface GenerativeResult {
  blobId: string
  x: number
  y: number
  w: number
  h: number
}

export interface GenerativeLayer extends LayerBase {
  kind: 'generative'
  prompt: string
  result: GenerativeResult | null
}

export type Layer = AdjustmentLayer | GenerativeLayer

/**
 * 裁剪与水平校正：先绕原图中心旋转 angle 度（正值为顺时针），
 * 再在与原图同尺寸的旋转后画布上取 rect（归一化）。
 */
export interface CropSpec {
  rect: NormRect
  angle: number
}

export interface AdjustmentSuggestion {
  id: string
  title: string
  reason: string
  mask: MaskSpec
  params: AdjustParams
}

export interface GenerativeSuggestion {
  id: string
  title: string
  reason: string
  prompt: string
  mask: MaskSpec
}

export interface CropSuggestion {
  id: string
  reason: string
  crop: CropSpec
}

export interface AnalysisResult {
  overall: string
  adjustments: AdjustmentSuggestion[]
  generativeEdits: GenerativeSuggestion[]
  crop: CropSuggestion | null
  model: string
  createdAt: number
}

/** 可序列化的工程文档，撤销/重做以它为快照单位（不含任何 Blob） */
export interface ProjectDoc {
  layers: Layer[]
  crop: CropSpec | null
  analysis: AnalysisResult | null
  /** 已采纳的建议 id */
  adopted: string[]
}

/** 工程元数据（projects 表），创建后只有名称会变 */
export interface ProjectRecord {
  id: string
  name: string
  createdAt: number
  /** 已按 EXIF 方向校正后的原图尺寸 */
  width: number
  height: number
  originalBlobId: string
  /** 原图 MIME 类型，导出时决定能否写回 EXIF */
  originalType: string
  /** 16 位线性 sRGB 底图；缺省表示使用旧版 8 位管线，不自动改变已有工程外观。 */
  linearBlobId?: string
  /** RAW 原件独立保留；originalBlobId 指向供显示和 AI 使用的 PNG 副本。 */
  rawSource?: {
    blobId: string
    name: string
    type: string
    filePath?: string
    decoder: string
    settings: import('libraw-wasm').LibRawSettings
    cameraMake?: string
    cameraModel?: string
  }
  thumbnail: Blob
  /** 所属相册；不在任何相册中时没有这一项 */
  albumId?: string
  /**
   * 手动排序的位置，整数、越小越靠前，整个图库共用一条顺序（相册里看到的是它的子序列）。
   * 没有这一项的工程（还没手动排过，或排过之后新导入、新移进相册的）排在所有手动排过的工程之前
   */
  order?: number
  /**
   * 这张照片对应的磁盘文件（桌面版）：从文件对话框导入时是原图的位置，否则是第一次「保存」选的位置。
   * 「保存」把结果写回这里；没有这一项时「保存」先让用户选位置
   */
  filePath?: string
}

/** 相册：工程的分组。一个工程最多属于一个相册；删除相册时其中的工程回到图库，不随之删除 */
export interface AlbumRecord {
  id: string
  name: string
  createdAt: number
  /** 侧栏里代替封面显示的 emoji；没有这一项时显示封面（相册里最近修改的那张照片） */
  emoji?: string
}

/**
 * 工程文档（docs 表，主键即工程 id）。与元数据分表存放，自动保存只需写这一行。
 * updatedAt 是工程最近一次修改（文档或名称）的时间，工程列表按它排序。
 */
export interface ProjectDocRecord {
  id: string
  doc: ProjectDoc
  updatedAt: number
}

export interface BlobRecord {
  id: string
  projectId: string
  blob: Blob
}
