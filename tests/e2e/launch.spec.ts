import { expect, type Page, test } from '@playwright/test'
import { skipSetupWizard } from './helpers'

/**
 * 启动画面（app/spa-loading-template.html）：应用脚本跑起来之前显示，根组件挂载后由 Nuxt 移除。
 * 扣住 /_nuxt/ 下的脚本让页面停在启动阶段；样式表照常放行，它们在 <head> 里阻塞渲染，启动画面依赖它们。
 */

/** 打开首页并扣住应用脚本，返回放行函数 */
async function openHeld(page: Page): Promise<() => void> {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/_nuxt/**', async (route) => {
    if (route.request().resourceType() === 'script') {
      await gate
    }
    await route.continue()
  })
  // 模块脚本执行完才会触发 DOMContentLoaded，只能等到响应开始
  await page.goto('/', { waitUntil: 'commit' })
  return release
}

const loader = (page: Page) => page.locator('#__nuxt-loader')

test.beforeEach(({ page }) => skipSetupWizard(page))

const DEEP = [
  { colorScheme: 'light', label: '浅色', color: 'rgb(229, 229, 234)' },
  { colorScheme: 'dark', label: '深色', color: 'rgb(28, 28, 30)' }
] as const

for (const { colorScheme, label, color } of DEEP) {
  test(`脚本加载期间铺满窗口显示应用图标，底色与${label}外观的 deep 一致，挂载后移除，侧栏标题是同一个图标`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    const release = await openHeld(page)

    const screen = loader(page).locator('> div')
    await expect(loader(page).locator('img')).toBeVisible()
    await expect(loader(page).locator('img')).toHaveAttribute('src', '/app-icon.svg')
    await expect(screen).toHaveCSS('position', 'fixed')
    await expect(screen).toHaveCSS('background-color', color)
    await expect(page.locator('body')).toHaveCSS('background-color', color)

    release()
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
    await expect(loader(page)).toHaveCount(0)

    const brand = page.getByRole('link', { name: 'AI 修图' }).locator('img')
    await expect(brand).toHaveAttribute('src', '/app-icon.svg')
    await expect.poll(() => brand.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    // 品牌名的文字盒裁到大写字母顶端与基线之间（约 0.73em），居中对齐的是字形而不是行框
    const name = page.getByRole('link', { name: 'AI 修图' }).locator('span')
    await expect(name).toHaveCSS('text-box-trim', 'trim-both')
    expect((await name.boundingBox())!.height).toBeLessThan(14)
  })
}

test('「正在启动」延迟 800ms 才浮现，正常启动时不闪一下转圈', async ({ page }) => {
  const release = await openHeld(page)

  const status = loader(page).getByRole('status')
  await expect(status).toHaveText('正在启动…')
  // 读动画自身的时间参数，不依赖测试机快慢
  const delays = await status.evaluate(el => el.getAnimations().map(animation => animation.effect?.getTiming().delay))
  expect(delays).toEqual([800])
  await expect(status).toHaveCSS('opacity', '1')
  await expect(status.locator('svg')).toHaveCSS('animation-name', 'spin')

  release()
  await expect(loader(page)).toHaveCount(0)
})

test('减少动态效果时转圈停下，「正在启动」仍然淡入', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const release = await openHeld(page)

  const status = loader(page).getByRole('status')
  await expect(status.locator('svg')).toHaveCSS('animation-name', 'none')
  await expect(status).toHaveCSS('opacity', '1')

  release()
  await expect(loader(page)).toHaveCount(0)
})
