import { expect, type Page, type Route, test } from '@playwright/test'

/**
 * 设置页的模型选择：从服务的 /models 获取列表后挑选，也可以直接输入任意名称。
 * OpenAI 兼容接口由 page.route 拦截模拟。
 */
const API = 'https://api.mock.test/v1'
const MODELS = ['whisper-1', 'gpt-image-2', 'gpt-6.1-sol', 'dall-e-3', 'gpt-6-luna']

const SETTINGS = {
  vision: { baseURL: API, apiKey: 'test-key', model: 'gpt-6.1-sol' },
  image: { sameAsVision: true, model: 'gpt-image-2' }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
}

/** 拦截 /models，返回请求计数器（不含 CORS 预检） */
async function mockModels(page: Page, status = 200): Promise<{ count: number }> {
  const counter = { count: 0 }
  await page.route(`${API}/models`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    counter.count++
    const body = status === 200
      ? { object: 'list', data: MODELS.map(id => ({ id, object: 'model', created: 0, owned_by: 'test' })) }
      : { error: { message: 'Not Found' } }
    await route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  })
  return counter
}

async function openSettings(page: Page, settings: unknown = SETTINGS) {
  await page.addInitScript((value) => {
    localStorage.setItem('apm-settings', JSON.stringify(value))
  }, settings)
  await page.goto('/settings')
}

const section = (page: Page, heading: string) => page.locator('section', { has: page.getByRole('heading', { name: heading }) })
const modelInput = (page: Page, heading: string) => section(page, heading).getByRole('combobox', { name: '模型', exact: true })
const savedSettings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('apm-settings')!))

test('首次展开自动获取模型列表，可筛选、选择，修图沿用连接时共用列表', async ({ page }) => {
  const requests = await mockModels(page)
  await openSettings(page)

  const visionInput = modelInput(page, '读图模型')
  await expect(visionInput).toHaveValue('gpt-6.1-sol')
  await visionInput.click()
  const options = page.getByRole('option')
  // 当前值不参与筛选，刚展开时显示完整列表（按名称排序）
  await expect(options).toHaveText(['dall-e-3', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-image-2', 'whisper-1'])
  expect(requests.count).toBe(1)

  await visionInput.fill('LUNA')
  await expect(options).toHaveText(['gpt-6-luna'])
  await options.first().click()
  await expect(visionInput).toHaveValue('gpt-6-luna')
  expect((await savedSettings(page)).vision.model).toBe('gpt-6-luna')

  // 修图沿用读图连接：共用已获取的列表，图像模型排在前面单独成组
  const imageInput = modelInput(page, '修图模型')
  await imageInput.click()
  await expect(page.getByRole('listbox').getByText('图像模型')).toBeVisible()
  await expect(options).toHaveText(['dall-e-3', 'gpt-image-2', 'gpt-6-luna', 'gpt-6.1-sol', 'whisper-1'])
  expect(requests.count).toBe(1)

  // 列表中没有的名称也可以直接使用
  await imageInput.fill('my-image-model')
  await expect(page.getByText('没有包含「my-image-model」的模型，将直接使用输入的名称')).toBeVisible()
  await imageInput.press('Escape')
  await expect(imageInput).toHaveValue('my-image-model')
  expect((await savedSettings(page)).image.model).toBe('my-image-model')

  // 右侧按钮重新获取并展开列表
  await section(page, '读图模型').getByRole('button', { name: '获取模型列表' }).click()
  await expect(options).toHaveCount(MODELS.length)
  expect(requests.count).toBe(2)
})

test('服务不提供模型列表或未填写 Key 时提示直接输入', async ({ page }) => {
  const requests = await mockModels(page, 404)
  await openSettings(page, { ...SETTINGS, image: { ...SETTINGS.image, sameAsVision: false, apiKey: '' } })

  const visionInput = modelInput(page, '读图模型')
  await visionInput.click()
  await expect(page.getByText('该服务不提供模型列表接口，请直接输入模型名称')).toBeVisible()
  await visionInput.press('Escape')
  expect(requests.count).toBe(1)

  await expect(section(page, '修图模型').getByRole('button', { name: '获取模型列表' })).toBeDisabled()
  await modelInput(page, '修图模型').click()
  await expect(page.getByText('填写 API Key 后可获取模型列表，也可以直接输入模型名称')).toBeVisible()
  expect(requests.count).toBe(1)
})
