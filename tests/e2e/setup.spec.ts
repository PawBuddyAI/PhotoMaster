import { expect, type Page, type Route, test } from '@playwright/test'

/**
 * 首次配置向导：全新状态打开应用时浮在图库之上，三步填好接口与模型；走完、跳过或关闭后不再弹出。
 * OpenAI 兼容接口由 page.route 拦截模拟。
 */
const API = 'https://api.mock.test/v1'
const MODELS = ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-image-2.5-sunburst']

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
}

async function fulfill(route: Route, body: unknown) {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS })
    return
  }
  await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

/** 模拟模型列表与读图接口，返回读图请求体（测试连接只发一次 json_schema 探测） */
async function mockService(page: Page): Promise<Array<Record<string, unknown>>> {
  const chats: Array<Record<string, unknown>> = []
  await page.route(`${API}/models`, route => fulfill(route, {
    object: 'list',
    data: MODELS.map(id => ({ id, object: 'model', created: 0, owned_by: 'test' }))
  }))
  await page.route(`${API}/chat/completions`, async (route) => {
    if (route.request().method() === 'POST') {
      chats.push(route.request().postDataJSON() as Record<string, unknown>)
    }
    await fulfill(route, {
      id: 'chatcmpl-setup',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-6-luna',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}', refusal: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    })
  })
  return chats
}

const wizard = (page: Page) => page.getByRole('dialog')
const stored = (page: Page, key: string) => page.evaluate(k => localStorage.getItem(k), key)
const savedSettings = async (page: Page) => JSON.parse((await stored(page, 'apm-settings'))!)

/** 向导没有弹出：主导航可见（向导打开时页面其余部分被标为 aria-hidden），且页面上没有弹窗 */
async function expectNoWizard(page: Page) {
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await expect(wizard(page)).toHaveCount(0)
}

test('全新打开时弹出向导：回车继续、填写接口、选模型并测试连接，开始使用后不再弹出', async ({ page }) => {
  const chats = await mockService(page)
  await page.goto('/')

  const dialog = wizard(page)
  await expect(dialog.getByRole('heading', { name: '欢迎使用 AI 修图' })).toBeVisible()
  await expect(dialog.getByRole('list', { name: '第 1 步，共 3 步' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '稍后设置' })).toBeVisible()
  // 点到弹窗外不关闭
  await page.mouse.click(8, 8)
  await expect(dialog).toBeVisible()

  // 打开时焦点停在弹窗本身，回车即「继续」；进入下一步后焦点落在第一个输入框
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('heading', { name: '连接 AI 服务' })).toBeVisible()
  await expect(dialog.getByRole('list', { name: '第 2 步，共 3 步' })).toBeVisible()
  const baseURL = dialog.getByLabel('Base URL')
  await expect(baseURL).toBeFocused()
  const proceed = dialog.getByRole('button', { name: '继续' })
  await expect(proceed).toBeDisabled()
  await baseURL.fill(API)
  await dialog.getByLabel('API Key').fill('test-key')
  await expect(proceed).toBeEnabled()
  await proceed.click()

  // 模型名称默认已填好，展开即获取模型列表
  await expect(dialog.getByRole('heading', { name: '选择模型' })).toBeVisible()
  const visionModel = dialog.getByRole('combobox', { name: '读图模型' })
  await expect(visionModel).toBeFocused()
  await expect(visionModel).toHaveValue('gpt-6.1-sol')
  await expect(dialog.getByRole('combobox', { name: '修图模型' })).toHaveValue('gpt-image-2.5-sunburst')
  await visionModel.click()
  await page.getByRole('option', { name: 'gpt-6-luna' }).click()
  await expect(visionModel).toHaveValue('gpt-6-luna')

  // 测试连接同时检查读图与修图，结果以通知条提示；点通知条不会关掉向导
  await dialog.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('读图模型连接正常', { exact: true })).toBeVisible()
  await expect(page.getByText('修图模型连接正常', { exact: true })).toBeVisible()
  expect(chats).toHaveLength(1)
  expect(chats[0]!.model).toBe('gpt-6-luna')
  await page.getByText('读图模型连接正常', { exact: true }).click()
  await expect(dialog).toBeVisible()

  // 返回上一步时已填的内容还在；第一步的取消按钮是「稍后设置」，第二步起是「返回」
  await dialog.getByRole('button', { name: '返回' }).click()
  await expect(dialog.getByLabel('Base URL')).toHaveValue(API)
  await dialog.getByRole('button', { name: '继续' }).click()
  await dialog.getByRole('button', { name: '开始使用' }).click()

  await expectNoWizard(page)
  await expect(page.getByText('还没有连接 AI 服务')).toHaveCount(0)
  expect(await stored(page, 'apm-setup')).toBe('done')
  const saved = await savedSettings(page)
  expect(saved.vision).toMatchObject({ baseURL: API, apiKey: 'test-key', model: 'gpt-6-luna', structuredOutput: 'json_schema' })
  expect(saved.image).toMatchObject({ sameAsVision: true, model: 'gpt-image-2.5-sunburst' })

  await page.reload()
  await expectNoWizard(page)
})

test('「稍后设置」跳过后不再弹出，图库仍提示未配置', async ({ page }) => {
  await page.goto('/')
  await wizard(page).getByRole('button', { name: '稍后设置' }).click()

  await expectNoWizard(page)
  await expect(page.getByText('还没有连接 AI 服务')).toBeVisible()
  expect(await stored(page, 'apm-setup')).toBe('done')

  await page.reload()
  await expectNoWizard(page)
  await expect(page.getByText('还没有连接 AI 服务')).toBeVisible()
})

test('中途按 Esc 关闭：已填写的内容保留，也算走过向导', async ({ page }) => {
  await page.goto('/')
  const dialog = wizard(page)
  await dialog.getByRole('button', { name: '继续' }).click()
  await dialog.getByLabel('API Key').fill('half-way-key')
  await page.keyboard.press('Escape')

  await expectNoWizard(page)
  expect(await stored(page, 'apm-setup')).toBe('done')
  expect((await savedSettings(page)).vision.apiKey).toBe('half-way-key')
})

test('有向导之前就已配好接口的用户直接进入图库', async ({ page }) => {
  await page.addInitScript((api) => {
    localStorage.setItem('apm-settings', JSON.stringify({ vision: { baseURL: api, apiKey: 'old-key', model: 'gpt-6.1-sol' } }))
  }, API)
  await page.goto('/')

  await expectNoWizard(page)
  expect(await stored(page, 'apm-setup')).toBe('done')
})
