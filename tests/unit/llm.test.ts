import { describe, expect, it } from 'vitest'
import { analyzeImage, parseAnalysisJson } from '~/lib/llm/analyze'
import { createOpenAIClient } from '~/lib/llm/client'
import { AnalysisFormatError, describeError } from '~/lib/llm/errors'
import { requestImageEdit } from '~/lib/llm/imageEdit'
import { normalizeAnalysis } from '~/lib/llm/schema'

interface Call {
  url: string
  init: RequestInit
}

type Responder = (call: Call, index: number) => Response | Promise<Response>

/** 记录请求并按顺序返回预设响应的 fetch（SDK 探测 FormData 支持时发出的 data: 请求交给真实 fetch） */
function mockFetch(responder: Responder) {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('data:')) {
      return fetch(input, init)
    }
    const call = { url, init }
    calls.push(call)
    return responder(call, calls.length - 1)
  }) as typeof fetch
  return { calls, fetchImpl }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const completion = (content: string) => json({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 0,
  model: 'test-model',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, refusal: null } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
})

const zeroParams = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, sharpen: 0
}

const SAMPLE = {
  overall: '主体偏暗，天空过曝。',
  adjustments: [
    { title: '提亮主体', reason: '主体偏暗', region: null, params: { ...zeroParams, exposure: 0.4, shadows: 20 } },
    { title: '压暗天空', reason: '天空过曝', region: { shape: 'linear', x0: 0.5, y0: 0, x1: 0.5, y1: 0.45 }, params: { ...zeroParams, exposure: -0.8, highlights: -40 } }
  ],
  generative_edits: [
    { title: '移除路人', reason: '干扰主体', prompt: 'Remove the pedestrian', region: { shape: 'rect', x0: 0.85, y0: 0.95, x1: 0.7, y1: 0.5 } }
  ],
  crop: null
}

const BASE_OPTIONS = {
  model: 'test-model',
  imageDataUrl: 'data:image/jpeg;base64,AAAA',
  imageW: 4000,
  imageH: 3000,
  detail: 'high' as const
}

function client(fetchImpl: typeof fetch, useProxy = false) {
  return createOpenAIClient({ baseURL: 'https://api.mock.test/v1/', apiKey: 'test-key', useProxy }, { fetch: fetchImpl, origin: 'http://localhost:3000' })
}

const bodyOf = (call: Call) => JSON.parse(String(call.init.body)) as Record<string, unknown>

describe('createOpenAIClient', () => {
  it('未填写 API Key 时报错', () => {
    expect(() => createOpenAIClient({ baseURL: '', apiKey: ' ', useProxy: false })).toThrow(/API Key/)
  })

  it('代理模式把请求发往本站代理，并在请求头中携带目标地址', async () => {
    const { calls, fetchImpl } = mockFetch(() => completion(JSON.stringify(SAMPLE)))
    await analyzeImage(client(fetchImpl, true), { ...BASE_OPTIONS, mode: 'json_schema' })
    expect(calls[0]!.url).toBe('http://localhost:3000/api/proxy/chat/completions')
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('x-target-base-url')).toBe('https://api.mock.test/v1')
  })
})

describe('analyzeImage', () => {
  it('json_schema 模式：携带图片与严格 schema，返回规范化结果', async () => {
    const { calls, fetchImpl } = mockFetch(() => completion(JSON.stringify(SAMPLE)))
    const outcome = await analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'json_schema' })
    expect(calls[0]!.url).toBe('https://api.mock.test/v1/chat/completions')
    const body = bodyOf(calls[0]!)
    expect((body.response_format as { type: string }).type).toBe('json_schema')
    expect(JSON.stringify(body.messages)).toContain('data:image/jpeg;base64,AAAA')
    expect(outcome.modeUsed).toBe('json_schema')
    expect(outcome.result.adjustments).toHaveLength(2)
    expect(outcome.result.adjustments[1]!.mask.shape).toBe('linear')
    expect(outcome.usage?.total_tokens).toBe(30)
  })

  it('服务不支持 json_schema 时降级为 json_object', async () => {
    const { calls, fetchImpl } = mockFetch((_, i) => i === 0
      ? json({ error: { message: 'response_format json_schema is not supported', type: 'invalid_request_error', param: 'response_format', code: null } }, 400)
      : completion(`\`\`\`json\n${JSON.stringify(SAMPLE)}\n\`\`\``))
    const outcome = await analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'json_schema' })
    expect(outcome.modeUsed).toBe('json_object')
    expect((bodyOf(calls[1]!).response_format as { type: string }).type).toBe('json_object')
  })

  it('json_object 也不支持时降级为纯提示词约束', async () => {
    const unsupported = json({ error: { message: 'Unsupported parameter: response_format', type: 'invalid_request_error', code: null } }, 400)
    const { calls, fetchImpl } = mockFetch((_, i) => i === 0 ? unsupported : completion(JSON.stringify(SAMPLE)))
    const outcome = await analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'json_object' })
    expect(outcome.modeUsed).toBe('none')
    expect(bodyOf(calls[1]!).response_format).toBeUndefined()
  })

  it('输出不合法时附带错误信息重试一次', async () => {
    const { calls, fetchImpl } = mockFetch((_, i) => completion(i === 0 ? '{"overall": 1}' : JSON.stringify(SAMPLE)))
    const outcome = await analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'json_object' })
    expect(outcome.result.overall).toBe(SAMPLE.overall)
    const retryMessages = bodyOf(calls[1]!).messages as Array<{ role: string, content: string }>
    expect(retryMessages.at(-2)!.role).toBe('assistant')
    expect(retryMessages.at(-1)!.content).toContain('不符合要求')
  })

  it('重试后仍不合法时抛出 AnalysisFormatError', async () => {
    const { fetchImpl } = mockFetch(() => completion('not json'))
    await expect(analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'none' })).rejects.toBeInstanceOf(AnalysisFormatError)
  })

  it('鉴权错误不会触发降级', async () => {
    const { calls, fetchImpl } = mockFetch(() => json({ error: { message: 'Incorrect API key', type: 'invalid_request_error', code: 'invalid_api_key' } }, 401))
    await expect(analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'json_schema' })).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(1)
  })
})

describe('parseAnalysisJson / normalizeAnalysis', () => {
  it('容忍代码块和前后文字', () => {
    const parsed = parseAnalysisJson(`好的，结果如下：\n\`\`\`json\n${JSON.stringify(SAMPLE)}\n\`\`\`\n希望有帮助`)
    expect(parsed.ok).toBe(true)
  })

  it('参数限幅、区域规范化、重绘区域不使用线性渐变、构图角度限制', () => {
    const raw = {
      ...SAMPLE,
      adjustments: [{ ...SAMPLE.adjustments[0]!, params: { ...zeroParams, exposure: 9, contrast: -300 } }],
      generative_edits: [{ ...SAMPLE.generative_edits[0]!, region: { shape: 'linear' as const, x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.6 } }],
      crop: { x0: 0, y0: 0, x1: 1, y1: 1, angle: 60, reason: '地平线倾斜' }
    } as Parameters<typeof normalizeAnalysis>[0]
    const result = normalizeAnalysis(raw, 4000, 3000, 'm')
    expect(result.adjustments[0]!.params.exposure).toBe(5)
    expect(result.adjustments[0]!.params.contrast).toBe(-100)
    expect(result.adjustments[0]!.mask.shape).toBe('full')
    expect(result.generativeEdits[0]!.mask.shape).toBe('rect')
    expect(result.generativeEdits[0]!.mask.rect).toEqual({ x: 0.2, y: 0.2, w: 0.2, h: expect.closeTo(0.4, 6) })
    expect(result.crop!.crop.angle).toBe(45)
    expect(result.crop!.crop.rect.w).toBeLessThan(1)
  })

  it('反向给出的角点被规范化', () => {
    const result = normalizeAnalysis(SAMPLE as Parameters<typeof normalizeAnalysis>[0], 4000, 3000, 'm')
    const rect = result.generativeEdits[0]!.mask.rect
    expect(rect.x).toBeCloseTo(0.7)
    expect(rect.y).toBeCloseTo(0.5)
    expect(rect.w).toBeCloseTo(0.15)
    expect(rect.h).toBeCloseTo(0.45)
  })
})

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('requestImageEdit', () => {
  const baseRequest = {
    model: 'gpt-image-2.5-sunburst',
    image: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    mask: new Blob([new Uint8Array([2])], { type: 'image/png' }),
    prompt: 'Remove the pedestrian',
    size: '1536x1024',
    quality: 'auto' as const,
    n: 2,
    stream: false,
    partialImages: 0
  }

  it('非流式：multipart 请求携带图像、蒙版和尺寸，返回全部候选', async () => {
    const { calls, fetchImpl } = mockFetch(() => json({
      created: 0,
      data: [{ b64_json: PNG_1PX }, { b64_json: PNG_1PX }],
      usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300, input_tokens_details: { image_tokens: 90, text_tokens: 10 } }
    }))
    const outcome = await requestImageEdit(client(fetchImpl), baseRequest)
    expect(calls[0]!.url).toBe('https://api.mock.test/v1/images/edits')
    const form = calls[0]!.init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('size')).toBe('1536x1024')
    expect(form.get('n')).toBe('2')
    expect(form.get('quality')).toBeNull()
    expect(form.get('mask')).toBeInstanceOf(Blob)
    expect(outcome.images).toHaveLength(2)
    expect(outcome.images[0]!.type).toBe('image/png')
    expect(outcome.usage).toEqual({ inputTokens: 100, outputTokens: 200, totalTokens: 300 })
  })

  it('流式：每个候选单独请求，回调中间图并汇总用量', async () => {
    const usage = { input_tokens: 1, output_tokens: 2, total_tokens: 3, input_tokens_details: { image_tokens: 1, text_tokens: 0 } }
    const common = { background: 'opaque', created_at: 0, output_format: 'png', quality: 'high', size: '1536x1024' }
    const sse = [
      `event: image_edit.partial_image\ndata: ${JSON.stringify({ ...common, type: 'image_edit.partial_image', b64_json: PNG_1PX, partial_image_index: 0 })}\n\n`,
      `event: image_edit.completed\ndata: ${JSON.stringify({ ...common, type: 'image_edit.completed', b64_json: PNG_1PX, usage })}\n\n`
    ].join('')
    const { calls, fetchImpl } = mockFetch(() => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }))
    const partials: number[] = []
    const outcome = await requestImageEdit(client(fetchImpl), { ...baseRequest, quality: 'high', stream: true, partialImages: 1 }, {
      onPartial: candidate => partials.push(candidate)
    })
    expect(calls).toHaveLength(2)
    const form = calls[0]!.init.body as FormData
    expect(form.get('stream')).toBe('true')
    expect(form.get('n')).toBe('1')
    expect(form.get('quality')).toBe('high')
    expect(partials.sort()).toEqual([0, 1])
    expect(outcome.images).toHaveLength(2)
    expect(outcome.usage?.totalTokens).toBe(6)
  })
})

describe('describeError', () => {
  it('内容审核拦截给出类别与阶段建议', async () => {
    const { fetchImpl } = mockFetch(() => json({
      error: {
        type: 'image_generation_user_error',
        code: 'moderation_blocked',
        message: 'blocked',
        moderation_details: { moderation_stage: 'input', categories: ['harassment'] }
      }
    }, 400))
    const error = await requestImageEdit(client(fetchImpl), {
      model: 'm',
      image: new Blob([new Uint8Array([1])]),
      mask: new Blob([new Uint8Array([1])]),
      prompt: 'p',
      size: '1024x1024',
      quality: 'auto',
      n: 1,
      stream: false,
      partialImages: 0
    }).catch(e => e)
    const friendly = describeError(error)
    expect(friendly.title).toContain('骚扰')
    expect(friendly.description).toContain('指令')
  })

  it('取消、鉴权与普通错误', async () => {
    expect(describeError(new DOMException('x', 'AbortError')).aborted).toBe(true)
    const { fetchImpl } = mockFetch(() => json({ error: { message: 'bad key', code: 'invalid_api_key' } }, 401))
    const err = await analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'none' }).catch(e => e)
    expect(describeError(err).title).toBe('API Key 无效')
    expect(describeError(new Error('boom')).description).toBe('boom')
  })
})
