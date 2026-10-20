import type OpenAI from 'openai'
import { APIError } from 'openai'

/** 服务没有实现 /models 接口时的常见状态码 */
const UNSUPPORTED_STATUS = new Set([404, 405, 501])

/** 修图模型下拉中优先列出、单独成组的图像模型 */
export const IMAGE_MODEL_GROUP = { label: '图像模型', pattern: /image|dall-e/i }

/** 数字按数值比较，gpt-4 排在 gpt-10 之前 */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * 获取服务提供的模型 ID 列表（自动翻页、去重、按名称排序）。
 * 返回 null 表示服务不提供模型列表接口（不代表模型不可用）；鉴权、网络等错误直接抛出。
 */
export async function listModels(client: OpenAI, signal?: AbortSignal): Promise<string[] | null> {
  try {
    const ids = new Set<string>()
    for await (const item of client.models.list({ signal })) {
      if (item.id) {
        ids.add(item.id)
      }
    }
    return [...ids].sort(collator.compare)
  } catch (err) {
    if (err instanceof APIError && err.status !== undefined && UNSUPPORTED_STATUS.has(err.status)) {
      return null
    }
    throw err
  }
}

/** 按关键字过滤模型（忽略大小写的子串匹配），关键字为空时返回全部 */
export function filterModels(models: readonly string[], query: string): string[] {
  const keyword = query.trim().toLowerCase()
  return keyword ? models.filter(id => id.toLowerCase().includes(keyword)) : [...models]
}

/** 把匹配 pattern 的模型分到前一组，其余模型保持原有顺序放到后一组 */
export function partitionModels(models: readonly string[], pattern: RegExp): [preferred: string[], others: string[]] {
  const preferred: string[] = []
  const others: string[] = []
  for (const id of models) {
    (pattern.test(id) ? preferred : others).push(id)
  }
  return [preferred, others]
}
