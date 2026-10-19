import { expect, type Page, test } from '@playwright/test'

/**
 * 图库与相册：在侧栏新建相册、在相册里导入照片、从编辑器回到来时的相册、
 * 在图库里把工程移出和移回相册、重命名与删除相册。不涉及模型接口。
 */
const PHOTO_NAME = 'album-e2e'

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

test('新建相册 → 在相册中导入 → 移出移回 → 重命名 → 删除相册后工程仍在图库', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.getByRole('navigation', { name: '主导航' })
  await expect(sidebar.getByText('还没有相册')).toBeVisible()
  const photoB64 = await makePhoto(page)

  // 侧栏里输入名称后回车，新相册被选中
  await sidebar.getByRole('button', { name: '新建相册' }).click()
  await sidebar.getByRole('textbox', { name: '新相册名称' }).fill('  云南旅行 ')
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/albums\//)
  const albumUrl = page.url()
  const albumLink = sidebar.getByRole('link', { name: /云南旅行/ })
  const albumCount = albumLink.locator('span').last()
  await expect(albumLink).toHaveAttribute('aria-current', 'page')
  await expect(albumCount).toHaveText('0')
  await expect(page.getByText('相册里还没有工程')).toBeVisible()

  // 在相册里导入，编辑器左上角的返回入口回到这个相册
  await page.locator('input[type=file]').setInputFiles({ name: `${PHOTO_NAME}.png`, mimeType: 'image/png', buffer: Buffer.from(photoB64, 'base64') })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()
  await page.getByRole('link', { name: '返回相册「云南旅行」' }).click()
  await page.waitForURL(albumUrl)
  const card = page.getByRole('link', { name: new RegExp(PHOTO_NAME) })
  await expect(card).toBeVisible()
  await expect(albumCount).toHaveText('1')

  // 直接打开相册链接（刷新）时，外壳重新读取图库
  await page.reload()
  await expect(card).toBeVisible()
  await expect(albumCount).toHaveText('1')

  // 在图库里移出相册，再移回去
  await sidebar.getByRole('link', { name: /图库/ }).click()
  await page.waitForURL(url => url.pathname === '/')
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '移出相册' }).click()
  await expect(albumCount).toHaveText('0')
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '移到相册' }).click()
  await page.getByRole('menuitem', { name: '云南旅行' }).click()
  await expect(albumCount).toHaveText('1')

  // 从图库打开的工程，返回入口回到图库
  await card.click()
  await page.waitForURL(/\/editor\//)
  await page.getByRole('link', { name: '返回图库' }).click()
  await page.waitForURL(url => url.pathname === '/')

  // 重命名相册
  await albumLink.click()
  await page.waitForURL(albumUrl)
  await page.getByRole('button', { name: '相册操作' }).click()
  await page.getByRole('menuitem', { name: '重命名相册' }).click()
  const nameInput = page.getByRole('textbox', { name: '相册名称' })
  // 菜单关闭后焦点落在输入框上，而不是回到菜单按钮
  await expect(nameInput).toBeFocused()
  await nameInput.fill('大理')
  await nameInput.press('Enter')
  await expect(sidebar.getByRole('link', { name: /大理/ })).toHaveAttribute('aria-current', 'page')
  await expect(nameInput).toBeHidden()

  // 删除相册：回到图库，工程还在
  await page.getByRole('button', { name: '相册操作' }).click()
  await page.getByRole('menuitem', { name: '删除相册' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('其中的 1 个工程不会被删除')
  await dialog.getByRole('button', { name: '删除相册' }).click()
  await page.waitForURL(url => url.pathname === '/')
  await expect(sidebar.getByText('还没有相册')).toBeVisible()
  await expect(card).toBeVisible()

  // 通过卡片菜单删除工程
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '删除工程' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(card).toBeHidden()
  await expect(sidebar.getByRole('link', { name: /图库/ }).locator('span').last()).toHaveText('0')

  // 已删除相册的链接给出说明，而不是空白页
  await page.goto(albumUrl)
  await expect(page.getByText('相册不存在')).toBeVisible()
})
