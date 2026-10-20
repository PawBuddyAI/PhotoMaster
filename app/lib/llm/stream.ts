import type OpenAI from 'openai'
import { APIUserAbortError } from 'openai'
import type { ChatCompletionChunk, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'

/** 流式回答到目前为止的内容：思考过程与回答正文分开 */
export interface ReplySnapshot {
  /** 思考过程：服务单独返回的 reasoning_content / reasoning，或正文开头 <think> 标签里的文字 */
  reasoning: string
  /** 回答正文，不含 <think> 段 */
  content: string
}

export interface StreamedReply extends ReplySnapshot {
  refusal: string
  finishReason: ChatCompletionChunk.Choice['finish_reason']
  usage?: CompletionUsage
}

/**
 * 思考过程不是 OpenAI 的标准字段，SDK 类型里没有：
 * DeepSeek、通义千问、vLLM 等放在 reasoning_content，OpenRouter、Ollama 等放在 reasoning。
 * 有的服务两个字段同时给同一段文字，每个分块只取其一，避免重复
 */
interface ReasoningDelta {
  reasoning_content?: string | null
  reasoning?: string | null
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

/**
 * 有些部署（如自建的 DeepSeek-R1、QwQ）把思考过程用 <think> 标签写在正文开头，这里拆出来归入思考过程。
 * 开头还不足以判断是不是标签时正文先记为空，免得界面把半个标签当成正文
 */
export function splitThinkTag(raw: string): ReplySnapshot {
  const head = raw.trimStart()
  if (THINK_OPEN.startsWith(head)) {
    return { reasoning: '', content: '' }
  }
  if (!head.startsWith(THINK_OPEN)) {
    return { reasoning: '', content: raw }
  }
  const body = head.slice(THINK_OPEN.length)
  const end = body.indexOf(THINK_CLOSE)
  return end < 0
    ? { reasoning: body, content: '' }
    : { reasoning: body.slice(0, end), content: body.slice(end + THINK_CLOSE.length) }
}

export interface StreamReplyOptions {
  signal?: AbortSignal
  /** 每收到一段思考或正文文字回调一次，参数是到目前为止的完整内容 */
  onSnapshot?: (snapshot: ReplySnapshot) => void
}

/**
 * 以流式请求对话补全，汇总成完整回答；输出过程中经 onSnapshot 汇报进度，界面可以边收边显示。
 * 流式响应默认不带用量，需要 stream_options.include_usage 才会在最后一个分块里返回。
 * SDK 在请求被取消时会安静地结束流，这里改为抛出取消错误，免得调用方把半截正文当成完整回答
 */
export async function streamChatReply(
  client: OpenAI,
  body: ChatCompletionCreateParamsNonStreaming,
  opts: StreamReplyOptions = {}
): Promise<StreamedReply> {
  const stream = await client.chat.completions.create({
    ...body,
    stream: true,
    stream_options: { include_usage: true }
  }, { signal: opts.signal })
  let separateReasoning = ''
  let raw = ''
  let refusal = ''
  let finishReason: StreamedReply['finishReason'] = null
  let usage: CompletionUsage | undefined
  const snapshot = (): ReplySnapshot => {
    const split = splitThinkTag(raw)
    return { reasoning: separateReasoning + split.reasoning, content: split.content }
  }
  for await (const chunk of stream) {
    usage = chunk.usage ?? usage
    const choice = chunk.choices[0]
    if (!choice) {
      continue
    }
    finishReason = choice.finish_reason ?? finishReason
    const delta = choice.delta as ChatCompletionChunk.Choice.Delta & ReasoningDelta
    const thought = delta.reasoning_content || delta.reasoning || ''
    separateReasoning += thought
    raw += delta.content ?? ''
    refusal += delta.refusal ?? ''
    if (thought || delta.content) {
      opts.onSnapshot?.(snapshot())
    }
  }
  if (opts.signal?.aborted) {
    throw new APIUserAbortError()
  }
  return { ...snapshot(), refusal, finishReason, usage }
}
