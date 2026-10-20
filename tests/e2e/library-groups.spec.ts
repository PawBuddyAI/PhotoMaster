import { expect, type Page, test } from '@playwright/test'
import { skipSetupWizard } from './helpers'

/**
 * 图库按相册分组：没有相册时没有展示方式切换；有相册后可以切到「按相册」，每个相册一组、空相册不出现、
 * 没放进相册的收在最后；在组与组之间拖动卡片会移动相册，组内拖动手动排序；展示方式刷新后保留，
 * 相册页没有这个切换。不涉及模型接口。
 */

/** 在浏览器里生成一张小照片并返回 base64 */
async function makePhoto(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const canvas = new OffscreenCanvas(400, 300)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c86b3c'
    ctx.fillRect(0, 0, 400, 300)
    ctx.fillStyle = '#2f5f8a'
    ctx.fillRect(0, 0, 400, 140)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  })
}

/** 分组视图的内容：每一组的标题和其中的卡片名称，按从上到下、从左到右的顺序 */
function groupsOf(page: Page): Promise<Array<[string, string[]]>> {
  return page.locator('section[aria-labelledby^="group-"]').evaluateAll(sections => sections.map(section => [
    section.querySelector('h3')?.textContent?.trim() ?? '',
    [...section.querySelectorAll('li[data-project]')].map(card => card.querySelector('p')?.textContent ?? '')
  ] as [string, string[]]))
}

function cardNames(page: Page): Promise<string[]> {
  return page.locator('li[data-project]').evaluateAll(cards => cards.map(card => card.querySelector('p')?.textContent ?? ''))
}

test.beforeEach(({ page }) => skipSetupWizard(page))

// 三组卡片纵向排开，窗口要高到不用滚动：Playwright 的 dragTo 会在按下鼠标后才把目标滚进视野，
// 页面在拖动中途滚动，浏览器就会从指针此刻所在的另一张卡片开始拖
test.use({ viewport: { width: 1440, height: 1500 } })

test('按相册分组：切换展示方式，组间拖动移动相册，组内拖动排序，刷新后保留', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.getByRole('navigation', { name: '主导航' })
  const libraryLink = sidebar.getByRole('link', { name: /图库/ })
  const viewAll = page.getByRole('tab', { name: '全部' })
  const viewAlbums = page.getByRole('tab', { name: '按相册' })
  const photo = await makePhoto(page)

  // 依次导入 a、b、c：最近修改在前，图库里是 c b a。还没有相册时没有展示方式的切换
  for (const name of ['a', 'b', 'c']) {
    await page.locator('input[type=file]').setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') })
    await page.waitForURL(/\/editor\//)
    await expect(page.getByText('正在加载图像')).toBeHidden()
    await page.getByRole('link', { name: '返回图库' }).click()
    await page.waitForURL(url => url.pathname === '/')
  }
  await expect.poll(() => cardNames(page)).toEqual(['c', 'b', 'a'])
  await expect(viewAlbums).toBeHidden()

  // 新建「旅行」「美食」和一个一直是空的「空相册」
  for (const name of ['旅行', '美食', '空相册']) {
    await sidebar.getByRole('button', { name: '新建相册' }).click()
    await page.getByRole('textbox', { name: '名称' }).fill(name)
    await page.getByRole('textbox', { name: '名称' }).press('Enter')
    await page.waitForURL(/\/albums\//)
    // 相册页本身就是一个相册，没有展示方式的切换
    await expect(viewAlbums).toBeHidden()
  }
  await libraryLink.click()
  await page.waitForURL(url => url.pathname === '/')
  const cards = page.locator('li[data-project]')
  await cards.filter({ hasText: /^a/ }).dragTo(sidebar.getByRole('link', { name: /旅行/ }), { steps: 10 })
  await expect(page.getByText('已移到相册「旅行」', { exact: true })).toBeVisible()
  await cards.filter({ hasText: /^c/ }).dragTo(sidebar.getByRole('link', { name: /美食/ }), { steps: 10 })
  await expect(page.getByText('已移到相册「美食」', { exact: true })).toBeVisible()

  // 默认「全部」：一个网格，没有分组标题；切到「按相册」：相册按侧栏顺序，空相册不出现，没放进相册的在最后
  await expect(viewAll).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => cardNames(page)).toEqual(['c', 'b', 'a'])
  await expect(page.locator('section[aria-labelledby^="group-"]')).toHaveCount(0)
  await viewAlbums.click()
  await expect(viewAlbums).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => groupsOf(page)).toEqual([['旅行', ['a']], ['美食', ['c']], ['未放入相册', ['b']]])

  // 拖到「未放入相册」一组里：移出相册，旅行这一组没有工程了，随之消失
  await cards.filter({ hasText: /^a/ }).dragTo(cards.filter({ hasText: /^b/ }), { steps: 10 })
  await expect(page.getByText('已移出相册', { exact: true })).toBeVisible()
  await expect.poll(() => groupsOf(page)).toEqual([['美食', ['c']], ['未放入相册', ['b', 'a']]])

  // 拖到另一个相册那一组里：移进该相册；已经在这一组里的卡片之间拖动是排序，不是移动
  await cards.filter({ hasText: /^b/ }).dragTo(cards.filter({ hasText: /^c/ }), { steps: 10 })
  // 前面把 c 拖进美食时的同名提示可能还没消失，新的那条排在最后
  await expect(page.getByText('已移到相册「美食」', { exact: true }).last()).toBeVisible()
  await expect.poll(() => groupsOf(page)).toEqual([['美食', ['c', 'b']], ['未放入相册', ['a']]])

  // 组内手动排序：把 b 放到 c 左半边，只动这一组
  await page.getByRole('button', { name: /^排序：/ }).click()
  await page.getByRole('menuitemcheckbox', { name: '手动排序' }).click()
  await expect(page.getByText('拖动卡片调整顺序')).toBeVisible()
  await cards.filter({ hasText: /^b/ }).dragTo(cards.filter({ hasText: /^c/ }), { targetPosition: { x: 12, y: 60 }, steps: 10 })
  await expect.poll(() => groupsOf(page)).toEqual([['美食', ['b', 'c']], ['未放入相册', ['a']]])

  // 切回「全部」是一个网格，手动顺序整个图库共用一条
  await viewAll.click()
  await expect(page.locator('section[aria-labelledby^="group-"]')).toHaveCount(0)
  await expect.poll(() => cardNames(page)).toEqual(['b', 'c', 'a'])
  await viewAlbums.click()

  // 刷新后展示方式和排序方式都在
  await page.reload()
  await expect(viewAlbums).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => groupsOf(page)).toEqual([['美食', ['b', 'c']], ['未放入相册', ['a']]])

  // 相册那一组的标题是进入该相册的链接
  await page.getByRole('heading', { name: '美食', level: 3 }).getByRole('link').click()
  await page.waitForURL(/\/albums\//)
  await expect.poll(() => cardNames(page)).toEqual(['b', 'c'])
  await expect(viewAlbums).toBeHidden()
})
