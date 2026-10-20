import { expect, type Page, type Route, test } from '@playwright/test'
import { skipSetupWizard } from './helpers'

/**
 * PawBuddy 账户：向导与设置页里的「登录 PawBuddy」（网页授权后跳回）、粘贴连接码、充值与断开。
 * PawBuddy 网站与网关都由 page.route 拦截模拟：授权页直接跳回 return 地址并带上连接码，不访问真实网站。
 */
const SITE = 'https://pawbuddy.mock.test'
const GATEWAY = `${SITE}/v1`
const DEFAULT_SITE = 'https://pawbuddy.chat'

const CORS = { 'access-control-allow-origin': '*' }

const TABLE = {
  models: [
    { id: 'deepseek-v4-flash' },
    { id: 'qwen3.8-max', capabilities: ['image'] },
    { id: 'kimi-k3', capabilities: ['image'] }
  ],
  image_models: [
    { id: 'image-2.5-flare', per_image: 0.2 },
    { id: 'image-2.5-sunburst', per_image: 0.2 }
  ]
}

/** 与 PawBuddy 网站 encodeConnectCode 相同的编码 */
function connectCode(email = 'me@example.com'): string {
  const json = JSON.stringify({ v: 1, gateway: GATEWAY, api: SITE, site: SITE, user: 42, email, key: 'sk-pawbuddy' })
  return `PB1.${Buffer.from(json).toString('base64url')}`
}

async function mockModelTable(page: Page) {
  await page.route(`${SITE}/data/model_pricing.json`, route => route.fulfill({
    status: 200,
    headers: { ...CORS, 'content-type': 'application/json' },
    body: JSON.stringify(TABLE)
  }))
}

/** 模拟网站授权页：记下请求地址，立即跳回 return 地址并在 # 片段里带上连接码 */
async function mockAuthorizePage(page: Page): Promise<string[]> {
  const visits: string[] = []
  await page.route(`${DEFAULT_SITE}/connect?**`, async (route: Route) => {
    visits.push(route.request().url())
    const back = new URL(route.request().url()).searchParams.get('return')!
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(`${back}#code=${encodeURIComponent(connectCode())}`)})</script>`
    })
  })
  return visits
}

const wizard = (page: Page) => page.getByRole('dialog')
const savedSettings = async (page: Page) => JSON.parse((await page.evaluate(() => localStorage.getItem('apm-settings')))!)

test('向导里登录 PawBuddy：网站授权后跳回，自动填好接口与官方模型，直接进入选择模型', async ({ page }) => {
  await mockModelTable(page)
  const visits = await mockAuthorizePage(page)
  await page.goto('/')

  const dialog = wizard(page)
  await dialog.getByRole('button', { name: '继续' }).click()
  await expect(dialog.getByRole('heading', { name: '连接模型接口' })).toBeVisible()
  await expect(dialog.getByText('推荐', { exact: true })).toBeVisible()
  await expect(dialog.getByText('或者使用自己的接口')).toBeVisible()
  await dialog.getByRole('button', { name: '登录 PawBuddy' }).click()

  // 网页版整页跳到授权页，跳回原页面；地址栏里的连接码随即去掉
  await expect(page.getByText('已连接 PawBuddy 账户', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/)
  expect(visits).toHaveLength(1)
  const authorize = new URL(visits[0]!)
  expect(authorize.pathname).toBe('/connect')
  expect(authorize.searchParams.get('app')).toBe('ai-photo')
  expect(authorize.searchParams.get('return')).toBe(new URL('/', page.url()).toString())

  // 向导重新打开在选择模型这一步，默认模型不在官方列表里，换成列表里的第一个
  await expect(dialog.getByRole('heading', { name: '选择模型' })).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: '读图模型' })).toHaveValue('qwen3.8-max')
  await expect(dialog.getByRole('combobox', { name: '修图模型' })).toHaveValue('image-2.5-flare')

  // 返回上一步看到的是已连接的账户，手动填写的接口收起
  await dialog.getByRole('button', { name: '返回' }).click()
  await expect(dialog.getByText('已连接 me@example.com')).toBeVisible()
  await expect(dialog.getByLabel('Base URL')).toHaveCount(0)
  await dialog.getByRole('button', { name: '继续' }).click()
  await dialog.getByRole('button', { name: '开始使用' }).click()
  await expect(dialog).toHaveCount(0)

  const saved = await savedSettings(page)
  expect(saved.vision).toMatchObject({ baseURL: GATEWAY, apiKey: 'sk-pawbuddy', useProxy: false, model: 'qwen3.8-max' })
  expect(saved.image).toMatchObject({ sameAsVision: true, model: 'image-2.5-flare' })
  expect(saved.pawbuddy).toEqual({ email: 'me@example.com', user: 42, site: SITE })
})

test('向导里粘贴连接码：回车即连接，不会被当成「继续」，连上后进入选择模型', async ({ page }) => {
  await mockModelTable(page)
  await page.goto('/')
  const dialog = wizard(page)
  await dialog.getByRole('button', { name: '继续' }).click()
  // 先填一个自己的接口，「继续」可用，回车若冒泡到弹窗就会直接进入下一步
  await dialog.getByLabel('API Key').fill('sk-own')
  await dialog.getByRole('button', { name: '粘贴连接码' }).click()
  const input = dialog.getByRole('textbox', { name: '连接码' })
  await input.fill(connectCode('paste@example.com'))
  await input.press('Enter')

  await expect(page.getByText('已连接 PawBuddy 账户', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '选择模型' })).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: '读图模型' })).toHaveValue('qwen3.8-max')
  expect((await savedSettings(page)).vision.apiKey).toBe('sk-pawbuddy')
})

test('设置页：无效连接码给出提示，连接后显示账户、充值打开网站，断开后回到手动填写', async ({ page, context }) => {
  await skipSetupWizard(page)
  await mockModelTable(page)
  await context.route(`${SITE}/purchase`, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>充值</title>' }))
  await page.goto('/settings')

  const vision = page.getByRole('region', { name: '读图模型' })
  await expect(vision.getByLabel('Base URL')).toBeVisible()
  await vision.getByRole('button', { name: '粘贴连接码' }).click()
  const input = vision.getByRole('textbox', { name: '连接码' })
  const submit = vision.getByRole('button', { name: '连接', exact: true })
  await expect(submit).toBeDisabled()
  await input.fill('PB1.not-a-code')
  await submit.click()
  await expect(page.getByText('连接码无效', { exact: true })).toBeVisible()
  expect((await savedSettings(page).catch(() => null))?.pawbuddy ?? null).toBeNull()

  await input.fill(connectCode())
  await submit.click()
  await expect(vision.getByText('已连接 me@example.com')).toBeVisible()
  await expect(vision.getByLabel('Base URL')).toHaveCount(0)
  await expect(vision.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('qwen3.8-max')

  const [purchase] = await Promise.all([
    context.waitForEvent('page'),
    vision.getByRole('button', { name: '充值' }).click()
  ])
  await expect(purchase).toHaveURL(`${SITE}/purchase`)
  await purchase.close()

  await vision.getByRole('button', { name: '断开' }).click()
  await expect(page.getByText('已断开 PawBuddy 账户', { exact: true })).toBeVisible()
  await expect(vision.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1')
  await expect(vision.getByRole('button', { name: '登录 PawBuddy' })).toBeVisible()
  const saved = await savedSettings(page)
  expect(saved.pawbuddy).toBeNull()
  expect(saved.vision).toMatchObject({ apiKey: '', model: 'gpt-6.1-sol' })

  // 刷新后仍是断开状态
  await page.reload()
  await expect(page.getByRole('region', { name: '读图模型' }).getByLabel('Base URL')).toBeVisible()
})
