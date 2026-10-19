import type OpenAI from 'openai'
import type { ImageEditParamsBase } from 'openai/resources/images'

export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ImageEditRequest {
  model: string
  image: Blob
  mask: Blob
  prompt: string
  /** WIDTHxHEIGHT */
  size: string
  quality: ImageQuality
  n: number
  /** 流式返回中间结果（服务需支持） */
  stream: boolean
  partialImages: number
  signal?: AbortSignal
}

export interface ImageEditUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ImageEditOutcome {
  images: Blob[]
  usage: ImageEditUsage | null
}

export interface ImageEditCallbacks {
  /** candidate：候选序号；partialIndex：该候选的第几张中间图 */
  onPartial?: (candidate: number, image: Blob, partialIndex: number) => void
}

/**
 * 调用 /v1/images/edits。只发送兼容服务普遍支持的字段；
 * 流式模式下每个候选单独发起一个 n=1 的流式请求，以便分别展示中间图。
 */
export async function requestImageEdit(client: OpenAI, req: ImageEditRequest, cb: ImageEditCallbacks = {}): Promise<ImageEditOutcome> {
  const base: ImageEditParamsBase = {
    model: req.model,
    image: new File([req.image], 'image.png', { type: 'image/png' }),
    mask: new File([req.mask], 'mask.png', { type: 'image/png' }),
    prompt: req.prompt,
    size: req.size,
    ...(req.quality !== 'auto' ? { quality: req.quality } : {})
  }

  if (!req.stream) {
    const response = await client.images.edit({ ...base, n: req.n, stream: false }, { signal: req.signal })
    const images = await Promise.all((response.data ?? []).map(item => imageItemToBlob(item)))
    if (images.length === 0) {
      throw new Error('服务没有返回图片')
    }
    const usage = response.usage
      ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens }
      : null
    return { images, usage }
  }

  const results = await Promise.all(Array.from({ length: req.n }, async (_, candidate) => {
    const stream = await client.images.edit({ ...base, n: 1, stream: true, partial_images: req.partialImages }, { signal: req.signal })
    let final: Blob | null = null
    let usage: ImageEditUsage | null = null
    for await (const event of stream) {
      if (event.type === 'image_edit.partial_image') {
        cb.onPartial?.(candidate, base64ToBlob(event.b64_json, `image/${event.output_format}`), event.partial_image_index)
      } else if (event.type === 'image_edit.completed') {
        final = base64ToBlob(event.b64_json, `image/${event.output_format}`)
        usage = { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens, totalTokens: event.usage.total_tokens }
      }
    }
    if (!final) {
      throw new Error('流式响应结束但没有收到最终图片')
    }
    return { image: final, usage }
  }))

  const usage = results.reduce<ImageEditUsage | null>((acc, r) => {
    if (!r.usage) return acc
    return {
      inputTokens: (acc?.inputTokens ?? 0) + r.usage.inputTokens,
      outputTokens: (acc?.outputTokens ?? 0) + r.usage.outputTokens,
      totalTokens: (acc?.totalTokens ?? 0) + r.usage.totalTokens
    }
  }, null)
  return { images: results.map(r => r.image), usage }
}

/** GPT Image 返回 base64；部分兼容服务返回 URL，两种都处理 */
async function imageItemToBlob(item: { b64_json?: string, url?: string }): Promise<Blob> {
  if (item.b64_json) {
    return base64ToBlob(item.b64_json, 'image/png')
  }
  if (item.url) {
    const res = await fetch(item.url)
    if (!res.ok) {
      throw new Error(`下载生成结果失败（${res.status}）`)
    }
    return res.blob()
  }
  throw new Error('返回结果中没有图片数据')
}

export function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type })
}
