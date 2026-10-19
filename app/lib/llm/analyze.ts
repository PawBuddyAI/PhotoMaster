import type OpenAI from 'openai'
import { APIError } from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { ReasoningEffort } from 'openai/resources/shared'
import { z } from 'zod'
import type { AnalysisResult, CropSpec } from '../types'
import { AnalysisFormatError } from './errors'
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserText, buildJsonInstruction } from './prompts'
import { AnalysisSchema, normalizeAnalysis } from './schema'

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
  mode: StructuredOutputMode
  detail: 'auto' | 'low' | 'high'
  reasoningEffort?: ReasoningEffortSetting
  hint?: string
  signal?: AbortSignal
}

export interface AnalyzeOutcome {
  result: AnalysisResult
  /** 实际使用的模式；发生降级时界面可据此更新设置 */
  modeUsed: StructuredOutputMode
  usage?: CompletionUsage
}

/**
 * 读图分析。优先使用 json_schema strict；服务端明确不支持或忽略 schema 时逐级降级，
 * 降级后的输出用同一个 zod schema 校验，失败时附带错误信息重试一次。
 */
export async function analyzeImage(client: OpenAI, opts: AnalyzeOptions): Promise<AnalyzeOutcome> {
  let mode = opts.mode
  if (mode === 'json_schema') {
    try {
      return await analyzeWithSchema(client, opts)
    } catch (err) {
      if (!shouldDowngrade(err)) {
        throw err
      }
      mode = 'json_object'
    }
  }
  if (mode === 'json_object') {
    try {
      return await analyzeWithJsonPrompt(client, opts, true)
    } catch (err) {
      if (!isUnsupportedFormatError(err)) {
        throw err
      }
    }
  }
  return analyzeWithJsonPrompt(client, opts, false)
}

function buildMessages(opts: AnalyzeOptions, systemSuffix?: string): ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: systemSuffix ? `${ANALYSIS_SYSTEM_PROMPT}\n\n${systemSuffix}` : ANALYSIS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: buildAnalysisUserText(opts.hint, opts.crop) },
        { type: 'image_url', image_url: { url: opts.imageDataUrl, detail: opts.detail } }
      ]
    }
  ]
}

async function analyzeWithSchema(client: OpenAI, opts: AnalyzeOptions): Promise<AnalyzeOutcome> {
  const completion = await client.chat.completions.parse({
    model: opts.model,
    ...reasoningParams(opts.reasoningEffort),
    messages: buildMessages(opts),
    response_format: zodResponseFormat(AnalysisSchema, 'photo_analysis')
  }, { signal: opts.signal })
  const message = completion.choices[0]?.message
  if (message?.refusal) {
    throw new AnalysisFormatError(`模型拒绝了请求：${message.refusal}`)
  }
  if (!message?.parsed) {
    throw new AnalysisFormatError('模型没有返回结构化结果')
  }
  return {
    result: normalizeAnalysis(message.parsed, opts.imageW, opts.imageH, opts.model),
    modeUsed: 'json_schema',
    usage: completion.usage
  }
}

async function analyzeWithJsonPrompt(client: OpenAI, opts: AnalyzeOptions, jsonObject: boolean): Promise<AnalyzeOutcome> {
  const schemaJson = JSON.stringify(z.toJSONSchema(AnalysisSchema))
  const messages = buildMessages(opts, buildJsonInstruction(schemaJson))
  let lastIssue = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await client.chat.completions.create({
      model: opts.model,
      ...reasoningParams(opts.reasoningEffort),
      messages,
      ...(jsonObject ? { response_format: { type: 'json_object' as const } } : {})
    }, { signal: opts.signal })
    const content = completion.choices[0]?.message?.content ?? ''
    const parsed = parseAnalysisJson(content)
    if (parsed.ok) {
      return {
        result: normalizeAnalysis(parsed.value, opts.imageW, opts.imageH, opts.model),
        modeUsed: jsonObject ? 'json_object' : 'none',
        usage: completion.usage
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
