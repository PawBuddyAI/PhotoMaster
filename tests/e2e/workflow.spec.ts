import { readFile } from 'node:fs/promises'
import { expect, type Page, type Route, test } from '@playwright/test'

/**
 * 端到端流程：导入 → AI 读图分析 → 采纳建议（区域调色 + 重绘）→ 生成式重绘 → 挑选结果 → 全分辨率导出；
 * 以及采纳构图建议后重新分析时，读图输入带上当前裁剪。
 * OpenAI 兼容接口由 page.route 拦截模拟，生产代码中没有任何测试分支。
 */
const API = 'https://api.mock.test/v1'
const IMAGE_W = 1600
const IMAGE_H = 1000
/** 与 app/lib/llm/analyze.ts 的 VISION_MAX_SIDE 一致 */
const VISION_MAX_SIDE = 1300

const SETTINGS = {
  vision: { baseURL: API, apiKey: 'test-key', useProxy: false, model: 'mock-vision', reasoningEffort: 'high', structuredOutput: 'json_schema', detail: 'high' },
  image: { baseURL: API, apiKey: 'test-key', useProxy: false, sameAsVision: true, model: 'mock-image', quality: 'high', n: 2, sizeMode: 'custom', maxLongSide: 2048, stream: false, partialImages: 0 }
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

/** 模拟读图接口：记录每次请求体，返回固定的分析结果 */
async function mockChat(page: Page, analysis: unknown): Promise<ChatBody[]> {
  const bodies: ChatBody[] = []
  await page.route(`${API}/chat/completions`, async (route) => {
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postDataJSON() as ChatBody)
    }
    await fulfillCors(route, {
      id: 'chatcmpl-e2e',
      object: 'chat.completion',
      created: 0,
      model: 'mock-vision',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(analysis), refusal: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    })
  })
  return bodies
}

type UserPart = { type: string, text?: string, image_url?: { url: string } }

const userParts = (body: ChatBody) => (body.messages as Array<{ content: unknown }>)[1]!.content as UserPart[]
const sentImageUrl = (body: ChatBody) => userParts(body).find(part => part.type === 'image_url')!.image_url!.url
const sentUserText = (body: ChatBody) => userParts(body).find(part => part.type === 'text')!.text!

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
  expect(chatBodies).toHaveLength(1)
  expect((chatBodies[0]!.response_format as { type: string }).type).toBe('json_schema')
  expect(chatBodies[0]!.reasoning_effort).toBe('high')
  expect(JSON.stringify(chatBodies[0]!.messages)).toContain('data:image/jpeg;base64,')
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
