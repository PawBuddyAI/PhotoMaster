import { describe, expect, it } from 'vitest'
import { analyzeImage, parseAnalysisJson } from '~/lib/llm/analyze'
import { createOpenAIClient } from '~/lib/llm/client'
import { AnalysisFormatError, describeError } from '~/lib/llm/errors'
import { requestImageEdit } from '~/lib/llm/imageEdit'
import { filterModels, listModels, partitionModels } from '~/lib/llm/models'
import { probeStructuredOutput } from '~/lib/llm/probe'
import { detectCoordDivisor, normalizeAnalysis } from '~/lib/llm/schema'

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
    { title: '压暗天空', reason: '天空过曝', region: { shape: 'linear', x0: 500, y0: 0, x1: 500, y1: 450 }, params: { ...zeroParams, exposure: -0.8, highlights: -40 } }
  ],
  generative_edits: [
    { title: '移除路人', reason: '干扰主体', prompt: 'Remove the pedestrian', region: { shape: 'rect', x0: 850, y0: 950, x1: 700, y1: 500 } }
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
    // 坐标约定为千分比，不向模型提供像素尺寸，避免模型改用像素坐标
    expect(JSON.stringify(body.response_format)).toContain('千分比')
    expect(JSON.stringify(body.messages)).toContain('0–1000')
    expect(JSON.stringify(body.messages)).not.toContain('4000')
    // 未设置思考等级时不发送该参数，兼容不认识它的服务
    expect(body).not.toHaveProperty('reasoning_effort')
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

  it('思考等级随每次请求发送，降级后仍保留', async () => {
    const { calls, fetchImpl } = mockFetch((_, i) => i === 0
      ? json({ error: { message: 'response_format json_schema is not supported', type: 'invalid_request_error', code: null } }, 400)
      : completion(JSON.stringify(SAMPLE)))
    await analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'json_schema', reasoningEffort: 'high' })
    expect(calls).toHaveLength(2)
    expect(calls.map(c => bodyOf(c).reasoning_effort)).toEqual(['high', 'high'])
  })

  it('思考等级为模型默认时不发送该参数', async () => {
    const { calls, fetchImpl } = mockFetch(() => completion(JSON.stringify(SAMPLE)))
    await analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'none', reasoningEffort: 'default' })
    expect(bodyOf(calls[0]!)).not.toHaveProperty('reasoning_effort')
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
      generative_edits: [{ ...SAMPLE.generative_edits[0]!, region: { shape: 'linear' as const, x0: 200, y0: 200, x1: 400, y1: 600 } }],
      crop: { x0: 0, y0: 0, x1: 1000, y1: 1000, angle: 60, reason: '地平线倾斜' }
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

  it('0–1000 千分比坐标换算为 0–1', () => {
    const raw = SAMPLE as Parameters<typeof normalizeAnalysis>[0]
    expect(detectCoordDivisor(raw)).toBe(1000)
    const result = normalizeAnalysis(raw, 4000, 3000, 'm')
    expect(result.adjustments[1]!.mask.line).toEqual({ x0: 0.5, y0: 0, x1: 0.5, y1: 0.45 })
  })

  it('模型没有遵守约定、输出 0–1 小数时按原值使用，结果与千分比一致', () => {
    const perMille = SAMPLE as Parameters<typeof normalizeAnalysis>[0]
    const unit = {
      ...perMille,
      adjustments: [perMille.adjustments[0]!, { ...perMille.adjustments[1]!, region: { shape: 'linear' as const, x0: 0.5, y0: 0, x1: 0.5, y1: 0.45 } }],
      generative_edits: [{ ...perMille.generative_edits[0]!, region: { shape: 'rect' as const, x0: 0.85, y0: 0.95, x1: 0.7, y1: 0.5 } }],
      crop: { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.95, angle: 0, reason: '收紧构图' }
    }
    expect(detectCoordDivisor(unit)).toBe(1)
    const fromUnit = normalizeAnalysis(unit, 4000, 3000, 'm')
    const fromPerMille = normalizeAnalysis({ ...perMille, crop: { x0: 100, y0: 50, x1: 900, y1: 950, angle: 0, reason: '收紧构图' } }, 4000, 3000, 'm')
    expect(fromUnit.adjustments[1]!.mask.line).toEqual(fromPerMille.adjustments[1]!.mask.line)
    expect(fromUnit.generativeEdits[0]!.mask.rect.x).toBeCloseTo(fromPerMille.generativeEdits[0]!.mask.rect.x)
    expect(fromUnit.generativeEdits[0]!.mask.rect.h).toBeCloseTo(fromPerMille.generativeEdits[0]!.mask.rect.h)
    expect(fromUnit.crop!.crop.rect.x).toBeCloseTo(fromPerMille.crop!.crop.rect.x)
    expect(fromUnit.crop!.crop.rect.w).toBeCloseTo(fromPerMille.crop!.crop.rect.w)
  })

  it('坐标单位按整次回答判断：贴近左上角的小区域不会被误当成 0–1 小数', () => {
    const raw = {
      ...SAMPLE,
      adjustments: [{ ...SAMPLE.adjustments[0]!, region: { shape: 'rect' as const, x0: 0, y0: 0, x1: 1, y1: 1 } }]
    } as Parameters<typeof normalizeAnalysis>[0]
    expect(detectCoordDivisor(raw)).toBe(1000)
    expect(normalizeAnalysis(raw, 4000, 3000, 'm').adjustments[0]!.mask.rect.w).toBeCloseTo(0.001)
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

  it('模型不支持所选思考等级时提示更换档位', async () => {
    const { fetchImpl } = mockFetch(() => json({
      error: { message: 'Unsupported value: \'reasoning_effort\' does not support \'max\' with this model.', type: 'invalid_request_error', param: 'reasoning_effort', code: 'unsupported_value' }
    }, 400))
    const err = await analyzeImage(client(fetchImpl), { ...BASE_OPTIONS, mode: 'json_schema', reasoningEffort: 'max' }).catch(e => e)
    const friendly = describeError(err)
    expect(friendly.title).toBe('模型不支持当前思考等级')
    expect(friendly.description).toContain('模型默认')
  })
})

describe('probeStructuredOutput', () => {
  it('测试连接带上思考等级，结构化输出可用时返回 json_schema', async () => {
    const { calls, fetchImpl } = mockFetch(() => completion('{"ok":true}'))
    const mode = await probeStructuredOutput(client(fetchImpl), 'test-model', 'low')
    expect(mode).toBe('json_schema')
    expect(bodyOf(calls[0]!).reasoning_effort).toBe('low')
  })

  it('思考等级为模型默认时不发送该参数', async () => {
    const { calls, fetchImpl } = mockFetch(() => completion('{"ok":true}'))
    await probeStructuredOutput(client(fetchImpl), 'test-model')
    expect(bodyOf(calls[0]!)).not.toHaveProperty('reasoning_effort')
  })
})

const modelPage = (ids: string[]) => json({
  object: 'list',
  data: ids.map(id => ({ id, object: 'model', created: 0, owned_by: 'test' }))
})

describe('listModels', () => {
  it('请求 /models，去重并按名称排序（数字按数值比较）', async () => {
    const { calls, fetchImpl } = mockFetch(() => modelPage(['gpt-10', 'gpt-image-2', 'GPT-4o', 'gpt-4', 'gpt-10']))
    const models = await listModels(client(fetchImpl))
    expect(calls[0]!.url).toBe('https://api.mock.test/v1/models')
    expect((calls[0]!.init.method ?? 'GET').toUpperCase()).toBe('GET')
    expect(models).toEqual(['gpt-4', 'GPT-4o', 'gpt-10', 'gpt-image-2'])
  })

  it('服务没有模型列表接口时返回 null', async () => {
    for (const status of [404, 405, 501]) {
      const { fetchImpl } = mockFetch(() => json({ error: { message: 'Not Found' } }, status))
      expect(await listModels(client(fetchImpl))).toBeNull()
    }
  })

  it('鉴权失败等错误直接抛出', async () => {
    const { fetchImpl } = mockFetch(() => json({ error: { message: 'bad key', code: 'invalid_api_key' } }, 401))
    const err = await listModels(client(fetchImpl)).catch(e => e)
    expect(describeError(err).title).toBe('API Key 无效')
  })
})

describe('filterModels / partitionModels', () => {
  const MODELS = ['dall-e-3', 'gpt-6.1-sol', 'gpt-image-2', 'GPT-Image-2.5-flare', 'whisper-1']

  it('忽略大小写的子串匹配，关键字为空时返回全部', () => {
    expect(filterModels(MODELS, ' IMAGE ')).toEqual(['gpt-image-2', 'GPT-Image-2.5-flare'])
    expect(filterModels(MODELS, '')).toEqual(MODELS)
    expect(filterModels(MODELS, 'claude')).toEqual([])
  })

  it('按规则分组且保持原有顺序', () => {
    const [preferred, others] = partitionModels(MODELS, /image|dall-e/i)
    expect(preferred).toEqual(['dall-e-3', 'gpt-image-2', 'GPT-Image-2.5-flare'])
    expect(others).toEqual(['gpt-6.1-sol', 'whisper-1'])
  })
})
