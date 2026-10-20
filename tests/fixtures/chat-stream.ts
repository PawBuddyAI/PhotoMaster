/**
 * 模拟 OpenAI 兼容服务的流式对话补全（SSE 事件）：思考过程与正文都切成小段依次写出，最后一个分块带用量。
 * 单元测试、浏览器端到端测试与桌面版模拟服务共用；需要控制节奏时用 chatChunk 等单个事件自行编排
 */

export interface ChatStreamOptions {
  /** 先于正文写出的思考过程 */
  reasoning?: string
  /** 思考过程所在的字段：DeepSeek、通义千问等用 reasoning_content，OpenRouter 等用 reasoning */
  reasoningField?: 'reasoning_content' | 'reasoning'
  finishReason?: string
}

const BASE = { id: 'chatcmpl-stream', object: 'chat.completion.chunk', created: 0, model: 'mock-vision' }

const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`

/** 每 7 个字一段，模拟模型逐词输出 */
export function pieces(text: string): string[] {
  return text.match(/[\s\S]{1,7}/g) ?? []
}

export function chatChunk(delta: object, finishReason: string | null = null): string {
  return event({ ...BASE, choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }] })
}

/** 请求了 stream_options.include_usage 时，服务在结束前单独发一个只带用量的分块 */
export const CHAT_USAGE_CHUNK = event({ ...BASE, choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })

export const CHAT_DONE = 'data: [DONE]\n\n'

export function chatStreamEvents(content: string, opts: ChatStreamOptions = {}): string[] {
  const field = opts.reasoningField ?? 'reasoning_content'
  return [
    chatChunk({ role: 'assistant', content: '' }),
    ...pieces(opts.reasoning ?? '').map(text => chatChunk({ [field]: text })),
    ...pieces(content).map(text => chatChunk({ content: text })),
    chatChunk({}, opts.finishReason ?? 'stop'),
    CHAT_USAGE_CHUNK,
    CHAT_DONE
  ]
}

export function chatStreamBody(content: string, opts?: ChatStreamOptions): string {
  return chatStreamEvents(content, opts).join('')
}
