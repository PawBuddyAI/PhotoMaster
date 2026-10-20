import { expect, type Page, type Route, test } from '@playwright/test'

/**
 * 配置向导：打开应用时没有读图 Key 就浮在图库之上，三步填好接口与模型；不能跳过，只有走完才关闭，没配好则每次打开都会弹出。
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
  // 回车即「继续」；进入下一步后焦点落在第一个输入框
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

  // 返回上一步时已填的内容还在
  await dialog.getByRole('button', { name: '返回' }).click()
  await expect(dialog.getByLabel('Base URL')).toHaveValue(API)
  await dialog.getByRole('button', { name: '继续' }).click()
  await dialog.getByRole('button', { name: '开始使用' }).click()

  await expectNoWizard(page)
  await expect(page.getByText('还没有连接 AI 服务')).toHaveCount(0)
  const saved = await savedSettings(page)
  expect(saved.vision).toMatchObject({ baseURL: API, apiKey: 'test-key', model: 'gpt-6-luna', structuredOutput: 'json_schema' })
  expect(saved.image).toMatchObject({ sameAsVision: true, model: 'gpt-image-2.5-sunburst' })

  await page.reload()
  await expectNoWizard(page)
})

test('没设置 API Key 时不能跳过：没有关闭与「稍后设置」，Esc 和点到弹窗外都关不掉，刷新后重新弹出', async ({ page }) => {
  await page.goto('/')
  const dialog = wizard(page)
  const skipExits = [dialog.getByRole('button', { name: '稍后设置' }), dialog.getByRole('button', { name: '返回' }), dialog.locator('[data-slot="close"]')]
  const expectNoExit = async () => {
    for (const exit of skipExits) {
      await expect(exit).toHaveCount(0)
    }
  }

  await expect(dialog.getByRole('heading', { name: '欢迎使用 AI 修图' })).toBeVisible()
  await expectNoExit()
  await page.keyboard.press('Escape')
  await page.mouse.click(8, 8)
  await expect(dialog).toBeVisible()

  // 第二步要填好接口与 Key 才能继续；返回第一步后同样没有出口
  await dialog.getByRole('button', { name: '继续' }).click()
  await expect(dialog.getByRole('button', { name: '继续' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '返回' }).click()
  await expect(dialog.getByRole('heading', { name: '欢迎使用 AI 修图' })).toBeVisible()
  await expectNoExit()

  await page.reload()
  await expect(wizard(page).getByRole('heading', { name: '欢迎使用 AI 修图' })).toBeVisible()
})

test('中途填了 Key 按 Esc 也关不掉；内容已保存，刷新后因为已配好不再弹出', async ({ page }) => {
  await page.goto('/')
  const dialog = wizard(page)
  await dialog.getByRole('button', { name: '继续' }).click()
  await dialog.getByLabel('API Key').fill('half-way-key')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect((await savedSettings(page)).vision.apiKey).toBe('half-way-key')

  await page.reload()
  await expectNoWizard(page)
})

test('已配好接口的用户直接进入图库；清空 Key 之后再打开应用重新弹出向导', async ({ page }) => {
  await page.addInitScript((api) => {
    if (localStorage.getItem('apm-settings') === null) {
      localStorage.setItem('apm-settings', JSON.stringify({ vision: { baseURL: api, apiKey: 'old-key', model: 'gpt-6.1-sol' } }))
    }
  }, API)
  await page.goto('/')
  await expectNoWizard(page)

  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('apm-settings')!)
    saved.vision.apiKey = ''
    localStorage.setItem('apm-settings', JSON.stringify(saved))
  })
  await page.reload()
  await expect(wizard(page).getByRole('heading', { name: '欢迎使用 AI 修图' })).toBeVisible()
})
