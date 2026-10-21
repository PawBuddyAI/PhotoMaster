import { expect, type Page, test } from '@playwright/test'
import { skipSetupWizard } from './helpers'

/**
 * 网页版的桌面版下载入口：站点 /download/ 下有发布清单（latest.json）才出现，侧栏、设置页与连接失败的提示共用同一份数据。
 * 清单由 page.route 模拟；开发服务器没有 /download/，未知路径会回退成 index.html（状态码 200），也一并模拟。
 */
const MANIFEST = {
  version: '0.1.0',
  file: 'ai-photo-master-setup.exe',
  sha256: 'a'.repeat(64),
  size: 9 * 1024 * 1024,
  date: '2026-10-21T00:00:00.000Z'
}
const INSTALLER_URL = '/download/ai-photo-master-setup.exe'
const BLOCKED_API = 'https://blocked.mock.test/v1'

/** 模拟站点上的 latest.json；不传表示站点没有发布，请求被回退成网页本身 */
async function mockRelease(page: Page, manifest?: object): Promise<void> {
  await page.route('**/download/latest.json', route => manifest
    ? route.fulfill({ json: manifest })
    : route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
}

/** 等清单请求有了结果，避免「没有入口」的断言在请求回来之前就空过 */
const manifestLoaded = (page: Page) => page.waitForResponse('**/download/latest.json')

test('站点有桌面版时，侧栏与设置页给出下载入口', async ({ page }) => {
  await skipSetupWizard(page)
  await mockRelease(page, MANIFEST)
  await page.goto('/')

  const sidebarLink = page.getByRole('link', { name: '下载桌面版' })
  await expect(sidebarLink).toHaveAttribute('href', INSTALLER_URL)
  await expect(sidebarLink).toHaveAttribute('download', '')
  await expect(sidebarLink).toContainText('v0.1.0')

  await page.getByRole('link', { name: '设置' }).click()
  const section = page.locator('section', { has: page.getByRole('heading', { name: '桌面版' }) })
  await expect(section).toContainText('版本 0.1.0，9.0 MB')
  const button = section.getByRole('link', { name: '下载 Windows 版' })
  await expect(button).toHaveAttribute('href', INSTALLER_URL)
  await expect(button).toHaveAttribute('download', '')
})

test('站点还没有发布桌面版时，不放打不开的下载入口', async ({ page }) => {
  await skipSetupWizard(page)
  await mockRelease(page)
  const loaded = manifestLoaded(page)
  await page.goto('/settings')
  await loaded

  await expect(page.getByRole('heading', { name: '读图模型' })).toBeVisible()
  await expect(page.getByRole('link', { name: /下载/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '桌面版' })).toHaveCount(0)
})

test.describe('配置向导首屏', () => {
  const dialog = (page: Page) => page.getByRole('dialog')
  /** offsetHeight 不受弹窗淡入时缩放动画的影响 */
  const dialogHeight = (page: Page) => dialog(page).evaluate(el => (el as HTMLElement).offsetHeight)

  test('欢迎页给出下载入口，弹窗高度与后面的步骤一致', async ({ page }) => {
    await mockRelease(page, MANIFEST)
    await page.goto('/')

    await expect(dialog(page).getByRole('heading', { name: '欢迎使用 AI 修图' })).toBeVisible()
    await expect(dialog(page).getByText('Windows 桌面版')).toBeVisible()
    const link = dialog(page).getByRole('link', { name: '下载' })
    await expect(link).toHaveAttribute('href', INSTALLER_URL)
    await expect(link).toHaveAttribute('download', '')
    const welcomeHeight = await dialogHeight(page)

    // 回车继续不受影响；后面的步骤没有这一行，三步等高、换步时不跳动
    await page.keyboard.press('Enter')
    await expect(dialog(page).getByRole('heading', { name: '连接 AI 服务' })).toBeVisible()
    await expect(dialog(page).getByRole('link', { name: '下载' })).toHaveCount(0)
    expect(await dialogHeight(page)).toBe(welcomeHeight)
  })

  test('站点没有桌面版时欢迎页不显示', async ({ page }) => {
    await mockRelease(page)
    const loaded = manifestLoaded(page)
    await page.goto('/')
    await loaded

    await expect(dialog(page).getByRole('heading', { name: '欢迎使用 AI 修图' })).toBeVisible()
    await expect(dialog(page).getByText('Windows 桌面版')).toHaveCount(0)
    await expect(dialog(page).getByRole('link', { name: '下载' })).toHaveCount(0)
  })
})

test.describe('网页版连不上服务', () => {
  const SETTINGS = { vision: { baseURL: BLOCKED_API, apiKey: 'test-key', model: 'mock-vision' } }

  async function testConnectionFails(page: Page): Promise<void> {
    await page.addInitScript((value) => {
      localStorage.setItem('apm-settings', JSON.stringify(value))
    }, SETTINGS)
    // 模拟服务不允许网页直接访问：请求在浏览器里就失败，SDK 报连接错误
    await page.route(`${BLOCKED_API}/**`, route => route.abort('failed'))
    await page.goto('/settings')
    const section = page.locator('section', { has: page.getByRole('heading', { name: '读图模型' }) })
    await section.getByRole('button', { name: '测试连接' }).click()
    // 提示条之外还有一份屏幕阅读器的隐藏播报，同样含这段文字，所以要精确匹配标题
    await expect(page.getByText('无法连接到服务', { exact: true })).toBeVisible()
  }

  test('站点有桌面版时，错误提示带「下载桌面版」按钮', async ({ page }) => {
    await mockRelease(page, MANIFEST)
    await testConnectionFails(page)

    // 侧栏一行之外，错误提示里还有一个；按钮是链接，直接下载安装包
    const links = page.getByRole('link', { name: '下载桌面版' })
    await expect(links).toHaveCount(2)
    await expect(links.last()).toHaveAttribute('href', INSTALLER_URL)
    await expect(links.last()).toHaveAttribute('download', '')
  })

  test('站点没有桌面版时，只有文字说明', async ({ page }) => {
    await mockRelease(page)
    const loaded = manifestLoaded(page)
    await testConnectionFails(page)
    await loaded

    await expect(page.locator('[data-slot="description"]', { hasText: '请改用桌面版' })).toBeVisible()
    await expect(page.getByRole('link', { name: /下载/ })).toHaveCount(0)
  })
})
