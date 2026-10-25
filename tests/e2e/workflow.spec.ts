import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, type Page, type Route, test } from '@playwright/test'
import { CHAT_DONE, CHAT_USAGE_CHUNK, chatChunk, chatStreamBody, pieces } from '../fixtures/chat-stream'
import { makeDng } from '../fixtures/dng'

/**
 * 端到端流程：导入 → AI 读图分析 → 采纳建议（区域调色 + 重绘）→ 生成式重绘 → 挑选结果 → 全分辨率导出；
 * 采纳构图建议后重新分析时，读图输入带上当前裁剪；以及分析过程中实时显示思考过程与方案草稿。
 * OpenAI 兼容接口由 page.route 拦截模拟（需要控制输出节奏的流式用例改用本地服务），生产代码中没有任何测试分支。
 */
const API = 'https://api.mock.test/v1'
const IMAGE_W = 1600
const IMAGE_H = 1000
/** 与 app/lib/llm/analyze.ts 的 VISION_MAX_SIDE 一致 */
const VISION_MAX_SIDE = 1300

const SETTINGS = {
  vision: { baseURL: API, apiKey: 'test-key', model: 'mock-vision', reasoningEffort: 'high', structuredOutput: 'json_schema', detail: 'high' },
  image: { baseURL: API, apiKey: 'test-key', sameAsVision: true, model: 'mock-image', quality: 'high', n: 2, sizeMode: 'custom', maxLongSide: 2048, stream: false, partialImages: 0 }
}

const zeroParams = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, sharpen: 0
}

/** 重绘区域（归一化）：右下角的“路人” */
const GEN_REGION = { x0: 0.6, y0: 0.55, x1: 0.8, y1: 0.95 }
/** 模型按约定输出 0–1000 的千分比坐标 */
const perMille = (r: typeof GEN_REGION) => ({
  x0: Math.round(r.x0 * 1000),
  y0: Math.round(r.y0 * 1000),
  x1: Math.round(r.x1 * 1000),
  y1: Math.round(r.y1 * 1000)
})

const ANALYSIS = {
  overall: '天空偏亮，右下角有干扰物。',
  adjustments: [
    { title: '压暗天空', reason: '天空过曝', region: { shape: 'linear', x0: 500, y0: 0, x1: 500, y1: 450 }, params: { ...zeroParams, exposure: -0.8, highlights: -30 } }
  ],
  generative_edits: [
    { title: '移除路人', reason: '干扰主体', prompt: 'Remove the person and fill with grass', region: { shape: 'rect', ...perMille(GEN_REGION) } }
  ],
  crop: null
}

/**
 * 只有构图建议：框为 100–900 千分比、校正 6°。该角度下四角仍在原图内，不会被收缩，
 * 原图中的裁剪四边形约为 (122,169)、(1395,35)、(1478,831)、(205,965)（1600×1000 像素）。
 */
const CROP_ANALYSIS = {
  overall: '四周留白偏多，地平线略斜。',
  adjustments: [],
  generative_edits: [],
  crop: { x0: 100, y0: 100, x1: 900, y1: 900, angle: 6, reason: '收紧构图并校正水平' }
}

/**
 * HDR 工程：整体提亮两档、高光 -50 两条全图建议，构图只保留左侧 40%。
 * makeDng 的默认画面从左往右变亮，左侧较暗
 */
const HDR_ANALYSIS = {
  overall: '画面偏暗，右侧高光还有余量。',
  adjustments: [
    { title: '整体提亮', reason: '画面偏暗', region: null, params: { ...zeroParams, exposure: 2 } },
    { title: '压暗高光', reason: '找回高光细节', region: null, params: { ...zeroParams, highlights: -50 } }
  ],
  generative_edits: [],
  crop: { x0: 0, y0: 0, x1: 400, y1: 1000, angle: 0, reason: '只保留较暗的左侧' }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
}

async function fulfillCors(route: Route, body: unknown) {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS })
    return
  }
  await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

type ChatBody = Record<string, unknown>

/** 模拟读图接口：记录每次请求体，以流式（SSE）返回固定的分析结果 */
async function mockChat(page: Page, analysis: unknown): Promise<ChatBody[]> {
  const bodies: ChatBody[] = []
  await page.route(`${API}/chat/completions`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    bodies.push(route.request().postDataJSON() as ChatBody)
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: chatStreamBody(JSON.stringify(analysis)) })
  })
  return bodies
}

type UserPart = { type: string, text?: string, image_url?: { url: string } }

const userParts = (body: ChatBody) => (body.messages as Array<{ content: unknown }>)[1]!.content as UserPart[]
const sentImageUrl = (body: ChatBody) => userParts(body).find(part => part.type === 'image_url')!.image_url!.url
const sentUserText = (body: ChatBody) => userParts(body).find(part => part.type === 'text')!.text!

/** 读图文字里的高光余量（百分比、档）；超过参考白的部分不到 0.1% 时都记为 0 */
function sentHeadroom(text: string): { above: number, peak: number } {
  if (text.includes('比参考白更亮的部分不到 0.1%')) {
    return { above: 0, peak: 0 }
  }
  const above = /约 ([\d.]+)% 的画面比参考白更亮/.exec(text)
  const peak = /最亮的部分比参考白高约 ([\d.]+) 档/.exec(text)
  return { above: Number(above![1]), peak: peak ? Number(peak[1]) : 0 }
}

async function importPhoto(page: Page, photoB64: string) {
  await page.locator('input[type=file]').setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: Buffer.from(photoB64, 'base64') })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()
}

/** 在浏览器里生成测试图片并返回 base64 */
async function makeImage(page: Page, kind: 'photo' | 'generated'): Promise<string> {
  return page.evaluate(async ({ kind, w, h }) => {
    const width = kind === 'photo' ? w : 1024
    const height = kind === 'photo' ? h : 1024
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    if (kind === 'photo') {
      for (let y = 0; y < height; y++) {
        ctx.fillStyle = y < height * 0.55 ? `rgb(${170 + y % 40}, ${200 - y % 30}, 235)` : `rgb(${50 + y % 20}, ${80 + y % 25}, 40)`
        ctx.fillRect(0, y, width, 1)
      }
      ctx.fillStyle = '#202020'
      ctx.fillRect(width * 0.66, height * 0.6, width * 0.06, height * 0.3)
    } else {
      ctx.fillStyle = '#3a6a2a'
      ctx.fillRect(0, 0, width, height)
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  }, { kind, w: IMAGE_W, h: IMAGE_H })
}

test('导入 → 分析 → 采纳 → 重绘 → 导出，蒙版外像素保持不变', async ({ page }) => {
  await page.addInitScript((settings) => {
    localStorage.setItem('apm-settings', JSON.stringify(settings))
  }, SETTINGS)

  const editBodies: string[] = []
  await page.goto('/')
  const generatedB64 = await makeImage(page, 'generated')
  const photoB64 = await makeImage(page, 'photo')

  const chatBodies = await mockChat(page, ANALYSIS)
  await page.route(`${API}/images/edits`, async (route) => {
    if (route.request().method() === 'POST') {
      editBodies.push(route.request().postDataBuffer()?.toString('latin1') ?? '')
    }
    await fulfillCors(route, {
      created: 0,
      data: [{ b64_json: generatedB64 }, { b64_json: generatedB64 }],
      usage: { input_tokens: 1000, output_tokens: 2000, total_tokens: 3000, input_tokens_details: { image_tokens: 900, text_tokens: 100 } }
    })
  })

  await importPhoto(page, photoB64)

  // AI 分析
  await page.getByRole('button', { name: '分析照片' }).click()
  await expect(page.getByText('天空偏亮，右下角有干扰物。')).toBeVisible()
  // 页面不展示读图模型的名字，只留本次用量
  await expect(page.getByText('mock-vision')).toHaveCount(0)
  await expect(page.getByText('用量：150 tokens')).toBeVisible()
  expect(chatBodies).toHaveLength(1)
  expect((chatBodies[0]!.response_format as { type: string }).type).toBe('json_schema')
  expect(chatBodies[0]!.reasoning_effort).toBe('high')
  expect(JSON.stringify(chatBodies[0]!.messages)).toContain('data:image/jpeg;base64,')
  // 普通照片不提 RAW / HDR
  expect(sentUserText(chatBodies[0]!)).not.toMatch(/RAW|HDR|参考白/)
  // 发送的图片统一缩放到 1300×1300 以内（测试图为 1600×1000）
  const sentSize = await page.evaluate(async (url) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob())
    return { w: bitmap.width, h: bitmap.height }
  }, sentImageUrl(chatBodies[0]!))
  expect(sentSize).toEqual({ w: VISION_MAX_SIDE, h: Math.round(IMAGE_H * VISION_MAX_SIDE / IMAGE_W) })

  // 采纳两条建议
  await page.getByRole('button', { name: '采纳', exact: true }).first().click()
  await page.getByRole('button', { name: '采纳', exact: true }).first().click()
  await expect(page.getByText('已采纳', { exact: true })).toHaveCount(2)

  // 重绘（采纳后选中的是重绘图层）
  await expect(page.getByPlaceholder('例如：移除画面中的行人')).toHaveValue('Remove the person and fill with grass')
  await page.getByRole('button', { name: '生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '应用所选' })).toBeVisible()
  expect(editBodies).toHaveLength(1)
  expect(editBodies[0]).toContain('name="mask"')
  expect(editBodies[0]).toMatch(/name="size"\r\n\r\n\d+x\d+/)
  expect(editBodies[0]).toContain('Only change the masked area')
  await page.getByRole('button', { name: '应用所选' }).click()
  await expect(page.getByText('已应用重绘结果').first()).toBeVisible()

  // 关闭调色图层，单独验证重绘补丁只改变蒙版区域
  await page.getByRole('tab', { name: /图层/ }).click()
  await page.getByRole('button', { name: '隐藏图层' }).last().click()

  // 导出 PNG
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'PNG（无损）' }).click()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  const download = await downloadPromise
  const exported = await readFile((await download.path())!)
  expect(download.suggestedFilename()).toBe('e2e-edited.png')

  const stats = await page.evaluate(async ({ exportedB64, originalB64, region }) => {
    const decode = async (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      return { w: bitmap.width, h: bitmap.height, data: canvas.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data }
    }
    const out = await decode(exportedB64)
    const orig = await decode(originalB64)
    const rx0 = region.x0 * orig.w
    const ry0 = region.y0 * orig.h
    const rx1 = region.x1 * orig.w
    const ry1 = region.y1 * orig.h
    let outsideMax = 0
    let insideSum = 0
    let insideCount = 0
    for (let y = 0; y < orig.h; y++) {
      for (let x = 0; x < orig.w; x++) {
        const i = (y * orig.w + x) * 4
        const diff = Math.max(Math.abs(out.data[i]! - orig.data[i]!), Math.abs(out.data[i + 1]! - orig.data[i + 1]!), Math.abs(out.data[i + 2]! - orig.data[i + 2]!))
        const inside = x > rx0 && x < rx1 && y > ry0 && y < ry1
        if (!inside) {
          outsideMax = Math.max(outsideMax, diff)
        } else if (x > rx0 + 60 && x < rx1 - 60 && y > ry0 + 60 && y < ry1 - 60) {
          insideSum += diff
          insideCount++
        }
      }
    }
    return { size: [out.w, out.h], outsideMax, insideMean: insideSum / insideCount }
  }, { exportedB64: exported.toString('base64'), originalB64: photoB64, region: GEN_REGION })

  expect(stats.size).toEqual([IMAGE_W, IMAGE_H])
  // 蒙版外只允许 GPU 半浮点往返的 1 级误差
  expect(stats.outsideMax).toBeLessThanOrEqual(1)
  // 蒙版中心被生成内容替换
  expect(stats.insideMean).toBeGreaterThan(10)
})

test('采纳构图建议后重新分析：框外压暗，提示词带上当前裁剪', async ({ page }) => {
  await page.addInitScript((settings) => {
    localStorage.setItem('apm-settings', JSON.stringify(settings))
  }, SETTINGS)
  await page.goto('/')
  const photoB64 = await makeImage(page, 'photo')
  const chatBodies = await mockChat(page, CROP_ANALYSIS)
  await importPhoto(page, photoB64)

  await page.getByRole('button', { name: '分析照片' }).click()
  await expect(page.getByText(CROP_ANALYSIS.overall)).toBeVisible()
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText('已采纳', { exact: true })).toHaveCount(1)

  // 重新分析后采纳状态清空，「采纳」按钮重新出现即表示第二次分析已返回
  await page.getByRole('button', { name: '重新分析当前效果' }).click()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeVisible()
  expect(chatBodies).toHaveLength(2)

  const [firstText, secondText] = chatBodies.map(sentUserText)
  expect(firstText).not.toContain('已经裁剪')
  expect(secondText).toContain('这张照片已经裁剪')
  expect(secondText).toContain('x0=100、y0=100、x1=900、y1=900')
  expect(secondText).toContain('水平校正 6°')

  // 两次发送的都是整张图；第二次裁剪四边形内不变、四边形外压暗
  const points = {
    inside: [[0.5, 0.3], [0.4, 0.75], [0.85, 0.07]],
    outside: [[0.03, 0.04], [0.97, 0.96], [0.15, 0.13]]
  }
  const ratios = await page.evaluate(async ({ urls, points }) => {
    const decode = async (url: string) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      return { w: bitmap.width, h: bitmap.height, ctx }
    }
    // 5×5 像素块的平均亮度，削弱 JPEG 噪声
    const brightness = (img: Awaited<ReturnType<typeof decode>>, [nx, ny]: number[]) => {
      const data = img.ctx.getImageData(Math.round(nx! * img.w) - 2, Math.round(ny! * img.h) - 2, 5, 5).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i]! + data[i + 1]! + data[i + 2]!
      }
      return sum / (data.length / 4) / 3
    }
    const [first, second] = await Promise.all(urls.map(decode))
    const ratio = (p: number[]) => brightness(second!, p) / brightness(first!, p)
    return {
      size: [first!.w, first!.h, second!.w, second!.h],
      inside: points.inside.map(ratio),
      outside: points.outside.map(ratio)
    }
  }, { urls: chatBodies.map(sentImageUrl), points })

  const sentH = Math.round(IMAGE_H * VISION_MAX_SIDE / IMAGE_W)
  expect(ratios.size).toEqual([VISION_MAX_SIDE, sentH, VISION_MAX_SIDE, sentH])
  // (0.85, 0.07) 在轴对齐框外、旋转四边形内；(0.15, 0.13) 在轴对齐框内、旋转四边形外，用来确认压暗区域随校正角度旋转
  for (const r of ratios.inside) {
    expect(r).toBeGreaterThan(0.95)
    expect(r).toBeLessThan(1.05)
  }
  // 压暗后亮度约为原来的 1 - 0.55
  for (const r of ratios.outside) {
    expect(r).toBeGreaterThan(0.35)
    expect(r).toBeLessThan(0.55)
  }
})

test('HDR 工程读图：说明是 RAW/HDR 并附上保留画面的高光余量，随裁剪与调整变化', async ({ page }) => {
  await page.addInitScript((settings) => {
    localStorage.setItem('apm-settings', JSON.stringify(settings))
  }, SETTINGS)
  await page.goto('/')
  const chatBodies = await mockChat(page, HDR_ANALYSIS)
  await page.locator('input[type=file]').setInputFiles({ name: 'HDR.dng', mimeType: '', buffer: makeDng() })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()

  const adopt = page.getByRole('button', { name: '采纳', exact: true })
  /** 发起第 n 次分析，等新结果显示（采纳状态清空，三条建议都能采纳），返回这次的用户文字 */
  async function analyze(n: number): Promise<string> {
    await page.getByRole('button', { name: n === 1 ? '分析照片' : '重新分析当前效果' }).click()
    await expect.poll(() => chatBodies.length).toBe(n)
    await expect(adopt).toHaveCount(3)
    return sentUserText(chatBodies[n - 1]!)
  }
  async function adoptAt(index: number): Promise<void> {
    await adopt.nth(index).click()
    await expect(page.getByText('已采纳', { exact: true })).toHaveCount(1)
  }

  const fullText = await analyze(1)
  expect(fullText).toContain('相机 RAW 照片')
  expect(fullText).toContain('发白的区域不一定丢了细节')
  const full = sentHeadroom(fullText)
  expect(full.above).toBeGreaterThan(0)

  // 只保留较暗的左侧：只统计裁剪框内，超过参考白的比例下降
  await adoptAt(2)
  const croppedText = await analyze(2)
  expect(croppedText).toContain('这张照片已经裁剪')
  const cropped = sentHeadroom(croppedText)
  expect(cropped.above).toBeLessThan(full.above)

  // 整体提亮两档：统计的是渲染后的当前效果
  await adoptAt(0)
  const brighter = sentHeadroom(await analyze(3))
  expect(brighter.above).toBeGreaterThan(cropped.above)
  expect(brighter.peak).toBeGreaterThan(0)

  // 高光 -50：最亮处压暗约一档，数值以档为单位
  await adoptAt(1)
  const recovered = sentHeadroom(await analyze(4))
  expect(brighter.peak - recovered.peak).toBeCloseTo(1, 0)
})

/** 测试里手动放行的关卡：本地服务写到某一步后停下，等断言完成再继续 */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

test('分析过程实时显示：思考过程与方案草稿逐步出现，不显示 JSON', async ({ page }) => {
  // 足够长，能撑满思考区，用来检查跟随滚动
  const reasoning = ['先看曝光：天空偏亮，地面偏暗。', '右下角有一个深色物体，像是路人。', '色温略冷，可以加一点暖色。', '地平线基本水平。']
    .map((line, i) => `第 ${i + 1} 步：${line}${'再仔细看看细节。'.repeat(3)}`)
    .join('\n\n')
  const content = JSON.stringify(ANALYSIS)
  // 第一段写到第一条调色建议的标题为止
  const cut = content.indexOf('"reason"')
  const toWriting = gate()
  const toFinish = gate()
  const bodies: ChatBody[] = []

  // page.route 只能一次性返回整个响应，这里用本地服务按节奏写出 SSE
  const server = createServer(async (req, res) => {
    // 真实的跨域检查里 Authorization 不在通配符 * 之内，预检时原样放行浏览器申请的请求头
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*' }).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatBody)
    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(chatChunk({ role: 'assistant', content: '' }))
    pieces(reasoning).forEach(text => res.write(chatChunk({ reasoning_content: text })))
    await toWriting.opened
    pieces(content.slice(0, cut)).forEach(text => res.write(chatChunk({ content: text })))
    await toFinish.opened
    pieces(content.slice(cut)).forEach(text => res.write(chatChunk({ content: text })))
    res.end(chatChunk({}, 'stop') + CHAT_USAGE_CHUNK + CHAT_DONE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  try {
    await page.addInitScript((settings) => {
      localStorage.setItem('apm-settings', JSON.stringify(settings))
    }, { ...SETTINGS, vision: { ...SETTINGS.vision, baseURL: `http://127.0.0.1:${port}/v1` } })
    await page.goto('/')
    await importPhoto(page, await makeImage(page, 'photo'))

    await page.getByRole('button', { name: '分析照片' }).click()
    await expect(page.getByText('AI 正在思考')).toBeVisible()
    await expect(page.getByLabel('AI 的思考过程')).toHaveText(reasoning)
    // 思考区跟着最新的文字滚到底（展开动画期间滚动无效，结束后补滚）
    await expect.poll(() => page.getByLabel('AI 的思考过程').evaluate(el =>
      el.scrollHeight > el.clientHeight && el.scrollHeight - el.scrollTop - el.clientHeight < 2)).toBe(true)
    await expect(page.getByRole('button', { name: '取消分析' })).toBeVisible()
    expect(bodies[0]!.stream).toBe(true)

    toWriting.open()
    await expect(page.getByText('AI 正在写修图方案')).toBeVisible()
    await expect(page.getByText(ANALYSIS.overall)).toBeVisible()
    await expect(page.getByText(ANALYSIS.adjustments[0]!.title)).toBeVisible()
    // 思考过程保留在上方；JSON 本身（键名、括号）不出现在界面上
    await expect(page.getByLabel('AI 的思考过程')).toHaveText(reasoning)
    await expect(page.locator('body')).not.toContainText('"overall"')
    await expect(page.locator('body')).not.toContainText('{"')
    // 草稿阶段还没有可采纳的建议
    await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)

    toFinish.open()
    await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(2)
    await expect(page.getByText('AI 正在写修图方案')).toBeHidden()
    await expect(page.getByLabel('AI 的思考过程')).toBeHidden()
    await expect(page.getByRole('button', { name: '重新分析当前效果' })).toBeVisible()
  } finally {
    toWriting.open()
    toFinish.open()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
