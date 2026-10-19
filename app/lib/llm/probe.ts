import type OpenAI from 'openai'
import { APIError } from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import type { ReasoningEffortSetting, StructuredOutputMode } from './analyze'
import { isUnsupportedFormatError, reasoningParams } from './analyze'

const PingSchema = z.object({ ok: z.boolean() })

/**
 * 探测读图服务支持的结构化输出能力（只发送极短的文本请求，成本可忽略）。
 * 带上与读图相同的思考等级，模型不支持该档位时在测试阶段就能暴露。
 * 鉴权、网络等非格式类错误直接抛出，由调用方提示。
 */
export async function probeStructuredOutput(
  client: OpenAI,
  model: string,
  reasoningEffort: ReasoningEffortSetting = 'default',
  signal?: AbortSignal
): Promise<StructuredOutputMode> {
  const base = { model, ...reasoningParams(reasoningEffort) }
  const messages = [{ role: 'user' as const, content: '这是一次连通性测试，请以 JSON 返回 {"ok": true}。' }]
  try {
    const completion = await client.chat.completions.parse({
      ...base,
      messages,
      response_format: zodResponseFormat(PingSchema, 'ping')
    }, { signal })
    if (completion.choices[0]?.message?.parsed) {
      return 'json_schema'
    }
  } catch (err) {
    if (!isUnsupportedFormatError(err) && !(err instanceof SyntaxError) && !(err instanceof z.ZodError)) {
      throw err
    }
  }
  try {
    await client.chat.completions.create({ ...base, messages, response_format: { type: 'json_object' } }, { signal })
    return 'json_object'
  } catch (err) {
    if (!isUnsupportedFormatError(err)) {
      throw err
    }
  }
  await client.chat.completions.create({ ...base, messages }, { signal })
  return 'none'
}

/**
 * 检查模型是否出现在服务的模型列表中。
 * 返回 null 表示服务不提供模型列表接口（不代表模型不可用）。
 */
export async function probeModelListed(client: OpenAI, model: string, signal?: AbortSignal): Promise<boolean | null> {
  try {
    for await (const item of client.models.list({ signal })) {
      if (item.id === model) {
        return true
      }
    }
    return false
  } catch (err) {
    if (err instanceof APIError && (err.status === 404 || err.status === 405 || err.status === 501)) {
      return null
    }
    throw err
  }
}
