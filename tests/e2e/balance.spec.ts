import { expect, type Page, test } from '@playwright/test'

const SITE = 'https://pawbuddy.mock.test'

async function setup(page: Page, connected = true, message = 'Insufficient account balance') {
  await page.addInitScript(({ site, connected }) => {
    localStorage.setItem('apm-settings', JSON.stringify({
      vision: { baseURL: `${site}/v1`, apiKey: 'sk-test', model: 'test-model' },
      pawbuddy: connected ? { site, user: 42, email: 'me@example.com' } : null
    }))
  }, { site: SITE, connected })
  await page.route(`${SITE}/v1/chat/completions`, route => route.fulfill({
    status: 403, json: { error: { message, type: 'billing_error' } }
  }))
  await page.route(`${SITE}/v1/models`, route => route.fulfill({ json: { data: [] } }))
  await page.goto('/settings')
  await page.getByRole('region', { name: '读图模型' }).getByRole('button', { name: '测试连接' }).click()
}

test('余额不足弹框查询余额、打开充值页、刷新并关闭；再次失败仍可打开', async ({ page, context }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'))
  let balance = 0
  let queries = 0
  await page.route(`${SITE}/v1/usage`, async (route) => {
    queries++
    expect(route.request().headers().authorization).toBe('Bearer sk-test')
    await route.fulfill({ json: { balance } })
  })
  await context.route(`${SITE}/purchase`, route => route.fulfill({ body: '<title>充值</title>' }))
  await setup(page)
  const dialog = page.getByRole('dialog', { name: '账户余额不足' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('status')).toContainText('¥0.00')
  await expect(page.getByText('没有访问权限', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('balance-dark.png'), animations: 'disabled' })
  const popupPromise = context.waitForEvent('page')
  await dialog.getByRole('button', { name: '去充值' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toBe(`${SITE}/purchase`)
  await popup.close()
  balance = 12.5
  await dialog.getByRole('button', { name: '刷新余额' }).click()
  await expect(dialog.getByRole('status')).toContainText('¥12.50')
  await expect(dialog.getByText(/已查到可用余额/)).toBeVisible()
  expect(queries).toBe(2)
  await dialog.getByRole('button', { name: '稍后再说' }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('region', { name: '读图模型' }).getByRole('button', { name: '测试连接' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('status')).toContainText('¥12.50')
  expect(queries).toBe(3)
})

test('余额查询失败仍可充值和刷新，不显示虚假的零余额', async ({ page }) => {
  await page.route(`${SITE}/v1/usage`, route => route.fulfill({ status: 503, body: 'unavailable' }))
  await setup(page)
  const dialog = page.getByRole('dialog', { name: '账户余额不足' })
  await expect(dialog.getByRole('alert')).toContainText('暂时无法查询余额')
  await expect(dialog.getByRole('status')).toContainText('—')
  await expect(dialog.getByRole('button', { name: '去充值' })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: '刷新余额' })).toBeEnabled()
})

test('手动连接的余额不足不会查询或引导充值 PawBuddy', async ({ page }, testInfo) => {
  let queries = 0
  await page.route(`${SITE}/v1/usage`, (route) => {
    queries++
    return route.abort()
  })
  await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'light'))
  await setup(page, false)
  const dialog = page.getByRole('dialog', { name: '账户余额不足' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/当前 AI 服务返回余额不足/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: '去充值' })).toHaveCount(0)
  expect(queries).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('balance-light.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '知道了' }).click()
  await expect(dialog).toHaveCount(0)
})

test('普通 403 保留权限错误，不弹出充值提示', async ({ page }) => {
  await setup(page, true, 'Access denied')
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '账户余额不足' })).toHaveCount(0)
})
