import type OpenAI from 'openai'
import { APIError } from 'openai'
import { partialParse } from 'openai/_vendor/partial-json-parser/parser'
import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/error'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { ReasoningEffort } from 'openai/resources/shared'
import { z } from 'zod'
import type { HighlightHeadroom } from '../image/hdr'
import type { AnalysisResult, CropSpec } from '../types'
import { AnalysisFormatError } from './errors'
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserText, buildJsonInstruction } from './prompts'
import { AnalysisSchema, normalizeAnalysis } from './schema'
import { type ReplySnapshot, streamChatReply } from './stream'

/** 结构化输出能力：json_schema（strict）→ json_object → none（纯提示词约束） */
export type StructuredOutputMode = 'json_schema' | 'json_object' | 'none'

/** 思考等级：default 表示不发送 reasoning_effort，由模型或服务自行决定 */
export type ReasoningEffortSetting = NonNullable<ReasoningEffort> | 'default'

/** 非推理模型和部分兼容服务不认识 reasoning_effort，选「模型默认」时整个参数都不发送 */
export function reasoningParams(effort: ReasoningEffortSetting = 'default'): { reasoning_effort?: ReasoningEffort } {
  return effort === 'default' ? {} : { reasoning_effort: effort }
}

/**
 * 读图图片统一缩放到 1300×1300 以内。部分模型会在服务端按各自规则再缩小，
 * 超出部分只增加上传体积和 token；客户端统一缩放后，不同模型看到的画面一致。
 * 区域与裁剪坐标是相对宽高的千分比，缩放不影响换算。
 */
export const VISION_MAX_SIDE = 1300

export interface AnalyzeOptions {
  model: string
  /** 读图用的 JPEG data URL，长边不超过 VISION_MAX_SIDE */
  imageDataUrl: string
  imageW: number
  imageH: number
  /** 当前裁剪；有裁剪时图片中框外已压暗，提示词同时说明保留区域 */
  crop?: CropSpec | null
  /** HDR 工程最终保留画面的高光余量；提供时提示词说明这是 RAW/HDR 照片并附上数据 */
  headroom?: HighlightHeadroom | null
  mode: StructuredOutputMode
  detail: 'auto' | 'low' | 'high'
  reasoningEffort?: ReasoningEffortSetting
  hint?: string
  signal?: AbortSignal
  /** 模型边想边写时回调进度，界面据此实时展示思考过程与方案草稿；每发出一次请求都从 waiting 重新开始 */
  onProgress?: (progress: AnalysisProgress) => void
}

export interface AnalyzeOutcome {
  result: AnalysisResult
  /** 实际使用的模式；发生降级时界面可据此更新设置 */
  modeUsed: StructuredOutputMode
  usage?: CompletionUsage
}

/** waiting：请求已发出、还没有输出；thinking：模型在思考；writing：模型在写出方案 */
export type AnalysisPhase = 'waiting' | 'thinking' | 'writing'

export interface AnalysisDraftItem {
  kind: 'adjustment' | 'generative' | 'crop'
  /** 调色与重绘建议取标题，构图建议取理由；还在输出时是写到一半的文字 */
  text: string
}

/** 从还没写完的方案里提取的可读文字。界面只展示这些，不展示 JSON 本身 */
export interface AnalysisDraft {
  overall: string
  items: AnalysisDraftItem[]
}

export interface AnalysisProgress {
  phase: AnalysisPhase
  /** 思考过程；服务不返回思考内容时一直为空 */
  reasoning: string
  draft: AnalysisDraft
  /** 上一次输出的格式不对、已经作废，这是重新生成的一次 */
  retrying: boolean
}

const EMPTY_DRAFT: AnalysisDraft = { overall: '', items: [] }

/** 还没有任何输出时的进度 */
export function waitingProgress(retrying = false): AnalysisProgress {
  return { phase: 'waiting', reasoning: '', draft: EMPTY_DRAFT, retrying }
}

/**
 * 读图分析。以流式输出，过程中经 onProgress 汇报进度；优先使用 json_schema strict，
 * 服务端明确不支持或忽略 schema 时逐级降级，降级后的输出用同一个 zod schema 校验，失败时附带错误信息重试一次。
 */
export async function analyzeImage(client: OpenAI, opts: AnalyzeOptions): Promise<AnalyzeOutcome> {
  let mode = opts.mode
  let retrying = false
  if (mode === 'json_schema') {
    try {
      return await analyzeWithSchema(client, opts)
    } catch (err) {
      if (!shouldDowngrade(err)) {
        throw err
      }
      // 参数被拒时还没有任何输出；服务忽略 schema 时已经显示过的内容作废
      retrying = !isUnsupportedFormatError(err)
      mode = 'json_object'
    }
  }
  if (mode === 'json_object') {
    try {
      return await analyzeWithJsonPrompt(client, opts, true, retrying)
    } catch (err) {
      if (!isUnsupportedFormatError(err)) {
        throw err
      }
    }
  }
  return analyzeWithJsonPrompt(client, opts, false, retrying)
}

/**
 * 每次请求开始时先报一次 waiting，让界面清掉上一次的内容；之后把流式快照换算成进度。
 * 正文没有新内容时（只来了思考文字）沿用上一次的草稿，不重复解析
 */
function progressReporter(onProgress: AnalyzeOptions['onProgress'], retrying: boolean): ((snapshot: ReplySnapshot) => void) | undefined {
  if (!onProgress) {
    return undefined
  }
  let content = ''
  let draft = EMPTY_DRAFT
  onProgress(waitingProgress(retrying))
  return (snapshot) => {
    if (snapshot.content !== content) {
      content = snapshot.content
      draft = extractAnalysisDraft(content) ?? draft
    }
    const phase: AnalysisPhase = content.trim() ? 'writing' : snapshot.reasoning.trim() ? 'thinking' : 'waiting'
    onProgress({ phase, reasoning: snapshot.reasoning, draft, retrying })
  }
}

function buildMessages(opts: AnalyzeOptions, systemSuffix?: string): ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: systemSuffix ? `${ANALYSIS_SYSTEM_PROMPT}\n\n${systemSuffix}` : ANALYSIS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: buildAnalysisUserText(opts.hint, opts.crop, opts.headroom) },
        { type: 'image_url', image_url: { url: opts.imageDataUrl, detail: opts.detail } }
      ]
    }
  ]
}

async function analyzeWithSchema(client: OpenAI, opts: AnalyzeOptions): Promise<AnalyzeOutcome> {
  const reply = await streamChatReply(client, {
    model: opts.model,
    ...reasoningParams(opts.reasoningEffort),
    messages: buildMessages(opts),
    response_format: zodResponseFormat(AnalysisSchema, 'photo_analysis')
  }, { signal: opts.signal, onSnapshot: progressReporter(opts.onProgress, false) })
  // 与 SDK 的 chat.completions.parse 一致：输出被截断或被内容过滤时直接报错，不再解析
  if (reply.finishReason === 'length') {
    throw new LengthFinishReasonError()
  }
  if (reply.finishReason === 'content_filter') {
    throw new ContentFilterFinishReasonError()
  }
  if (reply.refusal) {
    throw new AnalysisFormatError(`模型拒绝了请求：${reply.refusal}`)
  }
  if (!reply.content.trim()) {
    throw new AnalysisFormatError('模型没有返回结构化结果')
  }
  // 服务忽略了 schema 时这里抛出 SyntaxError 或 ZodError，由 analyzeImage 降级
  const parsed = AnalysisSchema.parse(JSON.parse(reply.content))
  return {
    result: normalizeAnalysis(parsed, opts.imageW, opts.imageH, opts.model),
    modeUsed: 'json_schema',
    usage: reply.usage
  }
}

async function analyzeWithJsonPrompt(client: OpenAI, opts: AnalyzeOptions, jsonObject: boolean, retrying: boolean): Promise<AnalyzeOutcome> {
  const schemaJson = JSON.stringify(z.toJSONSchema(AnalysisSchema))
  const messages = buildMessages(opts, buildJsonInstruction(schemaJson))
  let lastIssue = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await streamChatReply(client, {
      model: opts.model,
      ...reasoningParams(opts.reasoningEffort),
      messages,
      ...(jsonObject ? { response_format: { type: 'json_object' as const } } : {})
    }, { signal: opts.signal, onSnapshot: progressReporter(opts.onProgress, retrying || attempt > 0) })
    const content = reply.content
    const parsed = parseAnalysisJson(content)
    if (parsed.ok) {
      return {
        result: normalizeAnalysis(parsed.value, opts.imageW, opts.imageH, opts.model),
        modeUsed: jsonObject ? 'json_object' : 'none',
        usage: reply.usage
      }
    }
    lastIssue = parsed.issue
    messages.push(
      { role: 'assistant', content },
      { role: 'user', content: `上一次输出不符合要求：${parsed.issue}。请重新输出完整、合法的 JSON 对象。` }
    )
  }
  throw new AnalysisFormatError(`重试后仍无法解析模型输出：${lastIssue}`)
}

type ParseResult = { ok: true, value: z.infer<typeof AnalysisSchema> } | { ok: false, issue: string }

/** 从模型文本中提取 JSON 并按 schema 校验（容忍 Markdown 代码块和前后多余文字） */
export function parseAnalysisJson(content: string): ParseResult {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return { ok: false, issue: '没有找到 JSON 对象' }
  }
  let data: unknown
  try {
    data = JSON.parse(content.slice(start, end + 1))
  } catch (err) {
    return { ok: false, issue: `JSON 语法错误：${(err as Error).message}` }
  }
  const result = AnalysisSchema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map(i => `${i.path.join('.') || '(根)'}：${i.message}`)
    return { ok: false, issue: issues.join('；') }
  }
  return { ok: true, value: result.data }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 列表里每一项的某个文字字段，跳过还没写出内容的项 */
function textsOf(list: unknown, key: string): string[] {
  return (Array.isArray(list) ? list : [])
    .map(item => isRecord(item) ? item[key] : undefined)
    .filter((text): text is string => typeof text === 'string' && text.trim() !== '')
}

/**
 * 从还在输出的正文里提取方案草稿：总评，以及按输出顺序排列的各条建议（调色、重绘取标题，构图取理由）。
 * 正文可能是半截 JSON，也可能裹在代码块里，用 SDK 流式解析结构化输出时同一个容错解析器读取；
 * 还没开始写 JSON 时返回空草稿，暂时无法解析时返回 null，由调用方沿用上一次的草稿
 */
export function extractAnalysisDraft(content: string): AnalysisDraft | null {
  const start = content.indexOf('{')
  if (start < 0) {
    return EMPTY_DRAFT
  }
  let data: unknown
  try {
    data = partialParse(content.slice(start))
  } catch {
    return null
  }
  if (!isRecord(data)) {
    return null
  }
  return {
    overall: typeof data.overall === 'string' ? data.overall : '',
    items: [
      ...textsOf(data.adjustments, 'title').map(text => ({ kind: 'adjustment' as const, text })),
      ...textsOf(data.generative_edits, 'title').map(text => ({ kind: 'generative' as const, text })),
      ...textsOf([data.crop], 'reason').map(text => ({ kind: 'crop' as const, text }))
    ]
  }
}

/** 服务端明确拒绝了 response_format 参数 */
export function isUnsupportedFormatError(err: unknown): boolean {
  return err instanceof APIError
    && (err.status === 400 || err.status === 422)
    && /response_format|json_schema|json_object|structured|schema/i.test(err.message)
}

/** json_schema 需要降级的情况：参数不被支持，或服务端忽略了 schema 导致解析失败 */
function shouldDowngrade(err: unknown): boolean {
  return isUnsupportedFormatError(err) || err instanceof SyntaxError || err instanceof z.ZodError
}
