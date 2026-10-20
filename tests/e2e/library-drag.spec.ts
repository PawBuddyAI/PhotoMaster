import { expect, type Page, test } from '@playwright/test'
import { skipSetupWizard } from './helpers'

/**
 * 工程卡片的拖放与排序：拖到侧栏的相册上移进去、拖到「图库」上移出；排序菜单的四种方式；
 * 网格里拖到另一张卡片的前后手动排序，刷新后顺序与排序方式都还在。不涉及模型接口。
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

/** 当前页面上工程卡片的名称，按从左到右、从上到下的顺序 */
function cardNames(page: Page): Promise<string[]> {
  return page.locator('li[data-project]').evaluateAll(cards => cards.map(card => card.querySelector('p')?.textContent ?? ''))
}

test.beforeEach(({ page }) => skipSetupWizard(page))

test('拖到相册与「图库」移动工程；排序菜单与拖动手动排序，刷新后保留', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.getByRole('navigation', { name: '主导航' })
  const photo = await makePhoto(page)

  // 依次导入 a、b、c：最近修改在前，所以图库里是 c b a
  for (const name of ['a', 'b', 'c']) {
    await page.locator('input[type=file]').setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') })
    await page.waitForURL(/\/editor\//)
    await expect(page.getByText('正在加载图像')).toBeHidden()
    await page.getByRole('link', { name: '返回图库' }).click()
    await page.waitForURL(url => url.pathname === '/')
  }
  await expect.poll(() => cardNames(page)).toEqual(['c', 'b', 'a'])

  // 新建相册「旅行」，回到图库
  await sidebar.getByRole('button', { name: '新建相册' }).click()
  await page.getByRole('textbox', { name: '名称' }).fill('旅行')
  await page.getByRole('textbox', { name: '名称' }).press('Enter')
  await page.waitForURL(/\/albums\//)
  const albumLink = sidebar.getByRole('link', { name: /旅行/ })
  const albumCount = albumLink.locator('span').last()
  const libraryLink = sidebar.getByRole('link', { name: /图库/ })
  await libraryLink.click()
  await page.waitForURL(url => url.pathname === '/')

  // 拖到侧栏的相册上：放下前相册那一行描上蓝边，放下后进了相册，图库里仍能看到它
  const cardA = page.locator('li[data-project]').filter({ hasText: /^a/ })
  await cardA.dragTo(albumLink, { steps: 10 })
  await expect(page.getByText('已移到相册「旅行」', { exact: true })).toBeVisible()
  await expect(albumCount).toHaveText('1')
  await expect(albumLink).not.toHaveAttribute('data-dropping', /.*/)
  await expect.poll(() => cardNames(page)).toEqual(['c', 'b', 'a'])

  // 已经在这个相册里的工程不接受再放进来：数量不变、没有第二条提示
  await albumLink.click()
  await page.waitForURL(/\/albums\//)
  await expect.poll(() => cardNames(page)).toEqual(['a'])
  await page.locator('li[data-project]').first().dragTo(albumLink, { steps: 10 })
  await expect(albumCount).toHaveText('1')

  // 在相册页拖到「图库」上，移出相册；相册回到空相册
  await page.locator('li[data-project]').first().dragTo(libraryLink, { steps: 10 })
  await expect(page.getByText('已移出相册', { exact: true })).toBeVisible()
  await expect(albumCount).toHaveText('0')
  await expect(page.getByText('相册里还没有工程')).toBeVisible()
  await libraryLink.click()
  await page.waitForURL(url => url.pathname === '/')
  await expect.poll(() => cardNames(page)).toEqual(['c', 'b', 'a'])

  // 排序菜单：默认最近修改；名称按中文规则排，创建时间新的在前
  const sortButton = page.getByRole('button', { name: /^排序：/ })
  await expect(sortButton).toHaveText('排序：最近修改')
  await sortButton.click()
  await page.getByRole('menuitemcheckbox', { name: '名称' }).click()
  await expect(sortButton).toHaveText('排序：名称')
  await expect.poll(() => cardNames(page)).toEqual(['a', 'b', 'c'])
  await sortButton.click()
  await page.getByRole('menuitemcheckbox', { name: '创建时间' }).click()
  await expect.poll(() => cardNames(page)).toEqual(['c', 'b', 'a'])

  // 手动排序：先显示最近修改的顺序，并提示可以拖动；把 a 拖到 c 左半边，放在 c 的前面
  await sortButton.click()
  await page.getByRole('menuitemcheckbox', { name: '手动排序' }).click()
  await expect(page.getByText('拖动卡片调整顺序')).toBeVisible()
  await expect.poll(() => cardNames(page)).toEqual(['c', 'b', 'a'])
  const cards = page.locator('li[data-project]')
  await cards.filter({ hasText: /^a/ }).dragTo(cards.filter({ hasText: /^c/ }), { targetPosition: { x: 12, y: 60 }, steps: 10 })
  await expect.poll(() => cardNames(page)).toEqual(['a', 'c', 'b'])

  // 拖到右半边放在后面：把 a 放到 b 的后面
  await cards.filter({ hasText: /^a/ }).dragTo(cards.filter({ hasText: /^b/ }), { targetPosition: { x: 200, y: 60 }, steps: 10 })
  await expect.poll(() => cardNames(page)).toEqual(['c', 'b', 'a'])
  await cards.filter({ hasText: /^b/ }).dragTo(cards.filter({ hasText: /^c/ }), { targetPosition: { x: 12, y: 60 }, steps: 10 })
  await expect.poll(() => cardNames(page)).toEqual(['b', 'c', 'a'])

  // 刷新后顺序与排序方式都保留
  await page.reload()
  await expect(sortButton).toHaveText('排序：手动排序')
  await expect.poll(() => cardNames(page)).toEqual(['b', 'c', 'a'])

  // 在别的排序方式下直接拖：看到的顺序成为手动顺序，排序方式自动切到手动排序
  await sortButton.click()
  await page.getByRole('menuitemcheckbox', { name: '名称' }).click()
  await expect.poll(() => cardNames(page)).toEqual(['a', 'b', 'c'])
  await cards.filter({ hasText: /^c/ }).dragTo(cards.filter({ hasText: /^a/ }), { targetPosition: { x: 12, y: 60 }, steps: 10 })
  await expect(sortButton).toHaveText('排序：手动排序')
  await expect.poll(() => cardNames(page)).toEqual(['c', 'a', 'b'])
})
