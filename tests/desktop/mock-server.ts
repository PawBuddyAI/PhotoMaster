import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  path: string
  headers: IncomingHttpHeaders
  body: Buffer
}

export interface MockServerOptions {
  /** 读图接口返回的分析结果（连通性测试请求另行返回 {"ok": true}） */
  analysis: unknown
  /** 重绘接口返回的图片（base64 PNG），测试开始后才在 WebView 中生成，因此按需读取 */
  generatedB64: () => string
}

/**
 * 本地 OpenAI 兼容模拟服务，刻意不返回任何 CORS 响应头：
 * WebView 里的浏览器 fetch 必然被跨域拦截，只有经 Rust 端发出的请求才能成功。
 * OPTIONS 一律返回 405，便于确认请求没有经过浏览器预检。
 */
export async function startMockServer(options: MockServerOptions) {
  const requests: RecordedRequest[] = []
  const state = {
    /** 为 true 时重绘请求不作答，用于测试取消 */
    holdEdits: false,
    /** 客户端在响应前主动断开的重绘请求数 */
    abortedEdits: 0
  }

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(chunks)
    const path = req.url ?? ''
    requests.push({ method: req.method ?? '', path, headers: req.headers, body })

    if (req.method === 'OPTIONS') {
      res.writeHead(405).end()
    } else if (req.method === 'GET' && path === '/v1/models') {
      sendJson(res, { object: 'list', data: ['mock-vision', 'mock-image'].map(id => ({ id, object: 'model', created: 0, owned_by: 'mock' })) })
    } else if (req.method === 'POST' && path === '/v1/chat/completions') {
      const payload = JSON.parse(body.toString('utf8')) as { response_format?: { json_schema?: { name?: string } } }
      const ping = payload.response_format?.json_schema?.name === 'ping'
      sendJson(res, completion(ping ? { ok: true } : options.analysis))
    } else if (req.method === 'POST' && path === '/v1/images/edits') {
      if (state.holdEdits) {
        res.on('close', () => {
          if (!res.writableEnded) {
            state.abortedEdits++
          }
        })
        return
      }
      await answerImageEdit(res, body.toString('latin1'), options.generatedB64())
    } else {
      res.writeHead(404).end()
    }
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    state,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  }
}

function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function completion(content: unknown) {
  return {
    id: 'chatcmpl-desktop',
    object: 'chat.completion',
    created: 0,
    model: 'mock-vision',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content), refusal: null } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  }
}

const USAGE = { input_tokens: 1000, output_tokens: 2000, total_tokens: 3000, input_tokens_details: { image_tokens: 900, text_tokens: 100 } }

/** 按 multipart 中的 stream 字段返回 SSE（中间图 + 完成事件，分两次写出）或一次性 JSON */
async function answerImageEdit(res: ServerResponse, form: string, b64: string) {
  if (!/name="stream"\r\n\r\ntrue/.test(form)) {
    const n = Number(/name="n"\r\n\r\n(\d+)/.exec(form)?.[1] ?? 1)
    sendJson(res, { created: 0, data: Array.from({ length: n }, () => ({ b64_json: b64 })), usage: USAGE })
    return
  }
  const common = { background: 'opaque', created_at: 0, output_format: 'png', quality: 'high', size: '1024x1024' }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  res.write(`event: image_edit.partial_image\ndata: ${JSON.stringify({ ...common, type: 'image_edit.partial_image', b64_json: b64, partial_image_index: 0 })}\n\n`)
  await new Promise(resolve => setTimeout(resolve, 300))
  res.end(`event: image_edit.completed\ndata: ${JSON.stringify({ ...common, type: 'image_edit.completed', b64_json: b64, usage: USAGE })}\n\n`)
}
