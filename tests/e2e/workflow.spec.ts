import { readFile } from 'node:fs/promises'
import { expect, type Page, type Route, test } from '@playwright/test'

/**
 * 端到端流程：导入 → AI 读图分析 → 采纳建议（区域调色 + 重绘）→ 生成式重绘 → 挑选结果 → 全分辨率导出。
 * OpenAI 兼容接口由 page.route 拦截模拟，生产代码中没有任何测试分支。
 */
const API = 'https://api.mock.test/v1'
const IMAGE_W = 1600
const IMAGE_H = 1000

const SETTINGS = {
  vision: { baseURL: API, apiKey: 'test-key', useProxy: false, model: 'mock-vision', structuredOutput: 'json_schema', detail: 'high', maxLongSide: 1536 },
  image: { baseURL: API, apiKey: 'test-key', useProxy: false, sameAsVision: true, model: 'mock-image', quality: 'high', n: 2, sizeMode: 'custom', maxLongSide: 2048, stream: false, partialImages: 0 }
}

const zeroParams = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, sharpen: 0
}

/** 重绘区域（归一化）：右下角的“路人” */
const GEN_REGION = { x0: 0.6, y0: 0.55, x1: 0.8, y1: 0.95 }

const ANALYSIS = {
  overall: '天空偏亮，右下角有干扰物。',
  adjustments: [
    { title: '压暗天空', reason: '天空过曝', region: { shape: 'linear', x0: 0.5, y0: 0, x1: 0.5, y1: 0.45 }, params: { ...zeroParams, exposure: -0.8, highlights: -30 } }
  ],
  generative_edits: [
    { title: '移除路人', reason: '干扰主体', prompt: 'Remove the person and fill with grass', region: { shape: 'rect', ...GEN_REGION } }
  ],
  crop: null
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

  const chatBodies: Array<Record<string, unknown>> = []
  const editBodies: string[] = []
  await page.goto('/')
  const generatedB64 = await makeImage(page, 'generated')
  const photoB64 = await makeImage(page, 'photo')

  await page.route(`${API}/chat/completions`, async (route) => {
    if (route.request().method() === 'POST') {
      chatBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    }
    await fulfillCors(route, {
      id: 'chatcmpl-e2e',
      object: 'chat.completion',
      created: 0,
      model: 'mock-vision',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(ANALYSIS), refusal: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    })
  })
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

  // 导入
  await page.locator('input[type=file]').setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: Buffer.from(photoB64, 'base64') })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()

  // AI 分析
  await page.getByRole('button', { name: '分析照片' }).click()
  await expect(page.getByText('天空偏亮，右下角有干扰物。')).toBeVisible()
  expect(chatBodies).toHaveLength(1)
  expect((chatBodies[0]!.response_format as { type: string }).type).toBe('json_schema')
  expect(JSON.stringify(chatBodies[0]!.messages)).toContain('data:image/jpeg;base64,')

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
