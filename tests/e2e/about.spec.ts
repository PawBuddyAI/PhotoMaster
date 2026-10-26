import { expect, test } from '@playwright/test'
import pkg from '../../package.json' with { type: 'json' }
import { skipSetupWizard } from './helpers'

/**
 * 设置页的「关于」：网页版与桌面版都显示当前版本号与 GitHub 仓库地址。
 * 链接在新标签页打开；桌面版由 opener 插件把这类链接交给系统浏览器，这里只验证链接本身。
 */
test('设置页「关于」显示当前版本并链到 GitHub 仓库', async ({ page }) => {
  await skipSetupWizard(page)
  await page.goto('/settings')

  const section = page.locator('section', { has: page.getByRole('heading', { name: '关于' }) })
  await expect(section).toContainText(`版本 ${pkg.version}`)
  const link = section.getByRole('link', { name: '在 GitHub 查看' })
  await expect(link).toHaveAttribute('href', 'https://github.com/PawBuddyAI/PhotoMaster')
  await expect(link).toHaveAttribute('target', '_blank')
})
