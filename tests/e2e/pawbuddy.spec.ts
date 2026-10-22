import { expect, type Page, type Route, test } from '@playwright/test'
import { skipSetupWizard } from './helpers'

/**
 * PawBuddy 账户：向导与设置页里的「登录 PawBuddy」（网页授权后跳回）、粘贴连接码、账户预设（模型与思考等级）、充值与断开。
 * PawBuddy 网站由 page.route 拦截模拟：授权页直接跳回 return 地址并带上连接码，不访问真实网站。
 */
const SITE = 'https://pawbuddy.mock.test'
const GATEWAY = `${SITE}/v1`
const DEFAULT_SITE = 'https://pawbuddy.chat'

/** 连着账户时的预设，与 app/lib/pawbuddy.ts 的 PAWBUDDY_PRESET 一致 */
const PRESET = { visionModel: 'deepseek-v4.1-flash', reasoningEffort: 'max', imageModel: 'image-2.5-sunburst' }

/** 与 PawBuddy 网站 encodeConnectCode 相同的编码 */
function connectCode(email = 'me@example.com'): string {
  const json = JSON.stringify({ v: 1, gateway: GATEWAY, api: SITE, site: SITE, user: 42, email, key: 'sk-pawbuddy' })
  return `PB1.${Buffer.from(json).toString('base64url')}`
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
/** 通知条：向导最后一步的要点里也有「已连接 PawBuddy 账户」，断言通知时限定在通知区域 */
const toast = (page: Page, title: string) => page.getByLabel('通知（F8）').getByText(title, { exact: true })
const savedSettings = async (page: Page) => JSON.parse((await page.evaluate(() => localStorage.getItem('apm-settings')))!)

test('向导里登录 PawBuddy：网站授权后跳回，自动填好接口与模型，最后一步不再选模型', async ({ page }) => {
  const visits = await mockAuthorizePage(page)
  await page.goto('/')

  const dialog = wizard(page)
  await dialog.getByRole('button', { name: '继续' }).click()
  await expect(dialog.getByRole('heading', { name: '连接 AI 服务' })).toBeVisible()
  await expect(dialog.getByText('推荐', { exact: true })).toBeVisible()
  await expect(dialog.getByText('或者使用自己的接口')).toBeVisible()
  await dialog.getByRole('button', { name: '登录 PawBuddy' }).click()

  // 网页版整页跳到授权页，跳回原页面；地址栏里的连接码随即去掉
  await expect(toast(page, '已连接 PawBuddy 账户')).toBeVisible()
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/)
  expect(visits).toHaveLength(1)
  const authorize = new URL(visits[0]!)
  expect(authorize.pathname).toBe('/connect')
  expect(authorize.searchParams.get('app')).toBe('ai-photo')
  expect(authorize.searchParams.get('return')).toBe(new URL('/', page.url()).toString())

  // 向导重新打开在最后一步「准备就绪」：模型由账户预设，不显示模型输入框，只列出已配好的内容与测试连接
  await expect(dialog.getByRole('heading', { name: '准备就绪' })).toBeVisible()
  await expect(dialog.getByText('已连接 PawBuddy 账户')).toBeVisible()
  await expect(dialog.getByText('me@example.com')).toBeVisible()
  await expect(dialog.getByText('模型已经配好')).toBeVisible()
  await expect(dialog.getByRole('combobox')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '测试连接' })).toBeEnabled()

  // 返回上一步看到的是已连接的账户，手动填写的接口收起
  await dialog.getByRole('button', { name: '返回' }).click()
  await expect(dialog.getByText('已连接 me@example.com')).toBeVisible()
  await expect(dialog.getByLabel('Base URL')).toHaveCount(0)
  await dialog.getByRole('button', { name: '继续' }).click()
  await dialog.getByRole('button', { name: '开始使用' }).click()
  await expect(dialog).toHaveCount(0)

  const saved = await savedSettings(page)
  expect(saved.vision).toMatchObject({
    baseURL: GATEWAY,
    apiKey: 'sk-pawbuddy',
    model: PRESET.visionModel,
    reasoningEffort: PRESET.reasoningEffort
  })
  expect(saved.image).toMatchObject({ sameAsVision: true, model: PRESET.imageModel })
  expect(saved.pawbuddy).toEqual({ email: 'me@example.com', user: 42, site: SITE })
})

test('向导里粘贴连接码：回车即连接，不会被当成「继续」，连上后进入最后一步', async ({ page }) => {
  await page.goto('/')
  const dialog = wizard(page)
  await dialog.getByRole('button', { name: '继续' }).click()
  // 先填一个自己的接口，「继续」可用，回车若冒泡到弹窗就会直接进入下一步
  await dialog.getByLabel('API Key').fill('sk-own')
  await dialog.getByRole('button', { name: '粘贴连接码' }).click()
  const input = dialog.getByRole('textbox', { name: '连接码' })
  await input.fill(connectCode('paste@example.com'))
  await input.press('Enter')

  await expect(toast(page, '已连接 PawBuddy 账户')).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '准备就绪' })).toBeVisible()
  await expect(dialog.getByText('paste@example.com')).toBeVisible()
  // 这一步没有输入框，焦点交给弹窗本身，回车即「开始使用」
  await expect(dialog).toBeFocused()
  expect((await savedSettings(page)).vision.apiKey).toBe('sk-pawbuddy')
})

test('设置页：无效连接码给出提示，连接后显示账户、预设的几项不显示、充值打开网站，断开后回到手动填写', async ({ page, context }) => {
  await skipSetupWizard(page)
  await context.route(`${SITE}/purchase`, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>充值</title>' }))
  await page.goto('/settings')

  const account = page.getByRole('region', { name: 'PawBuddy 账户' })
  const vision = page.getByRole('region', { name: '读图模型' })
  const image = page.getByRole('region', { name: '修图模型' })
  const visionModel = vision.getByRole('combobox', { name: '模型', exact: true })
  const imageModel = image.getByRole('combobox', { name: '模型', exact: true })
  const reasoningEffort = vision.getByText('思考等级', { exact: true })
  const sameAsVision = image.getByText('沿用读图模型的连接配置')
  await expect(vision.getByLabel('Base URL')).toBeVisible()
  await account.getByRole('button', { name: '粘贴连接码' }).click()
  const input = account.getByRole('textbox', { name: '连接码' })
  const submit = account.getByRole('button', { name: '连接', exact: true })
  await expect(submit).toBeDisabled()
  await input.fill('PB1.not-a-code')
  await submit.click()
  await expect(page.getByText('连接码无效', { exact: true })).toBeVisible()
  expect((await savedSettings(page).catch(() => null))?.pawbuddy ?? null).toBeNull()

  await input.fill(connectCode())
  await submit.click()
  await expect(account.getByText('已连接 me@example.com')).toBeVisible()
  await expect(vision.getByLabel('Base URL')).toHaveCount(0)
  // 模型、思考等级由账户预设，修图只能沿用账户的连接：这几行都不显示，其余选项照常
  await expect(visionModel).toHaveCount(0)
  await expect(imageModel).toHaveCount(0)
  await expect(reasoningEffort).toHaveCount(0)
  await expect(sameAsVision).toHaveCount(0)
  await expect(vision.getByText('结构化输出', { exact: true })).toBeVisible()
  await expect(image.getByText('候选数量', { exact: true })).toBeVisible()
  expect((await savedSettings(page)).vision).toMatchObject({ model: PRESET.visionModel, reasoningEffort: PRESET.reasoningEffort })

  // 刷新后仍然不显示
  await page.reload()
  await expect(account.getByText('已连接 me@example.com')).toBeVisible()
  await expect(visionModel).toHaveCount(0)

  const [purchase] = await Promise.all([
    context.waitForEvent('page'),
    account.getByRole('button', { name: '充值' }).click()
  ])
  await expect(purchase).toHaveURL(`${SITE}/purchase`)
  await purchase.close()

  await account.getByRole('button', { name: '断开' }).click()
  await expect(page.getByText('已断开 PawBuddy 账户', { exact: true })).toBeVisible()
  await expect(vision.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1')
  await expect(account.getByRole('button', { name: '登录 PawBuddy' })).toBeVisible()
  // 断开后模型与思考等级回到默认，几行重新显示，可以自己选
  await expect(visionModel).toHaveValue('gpt-6.1-sol')
  await expect(imageModel).toHaveValue('gpt-image-2.5-sunburst')
  await expect(reasoningEffort).toBeVisible()
  await expect(sameAsVision).toBeVisible()
  const saved = await savedSettings(page)
  expect(saved.pawbuddy).toBeNull()
  expect(saved.vision).toMatchObject({ apiKey: '', model: 'gpt-6.1-sol', reasoningEffort: 'default' })
  expect(saved.image.model).toBe('gpt-image-2.5-sunburst')

  // 刷新后仍是断开状态；断开清掉了 Key，重新打开应用会弹出向导，不能跳过，在向导里填上自己的接口才能回到设置页
  await page.reload()
  await expect(wizard(page).getByRole('heading', { name: '欢迎使用 AI修图大师' })).toBeVisible()
  await wizard(page).getByRole('button', { name: '继续' }).click()
  await expect(wizard(page).getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1')
  await expect(wizard(page).getByRole('button', { name: '登录 PawBuddy' })).toBeVisible()
})
