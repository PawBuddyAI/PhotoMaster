import { expect, type Page, test } from '@playwright/test'
import { skipSetupWizard } from './helpers'

/**
 * 画布交互：单击照片外的空白处取消选中图层；裁剪后画笔圆圈的显示。不涉及模型接口。
 * 照片适应窗口后四周留有空白，舞台左上角附近的点一定落在照片之外；
 * 选中与否从图层列表的 aria-current、检查器的标题与空状态读出
 */
const PHOTO_NAME = 'canvas-e2e'

// 通知条也是 li（Reka Toast 带 data-swipe-direction），按文字找图层行时要排除
const layerRow = (page: Page, name: string) => page.locator('li:not([data-swipe-direction])').filter({ hasText: name })

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

/** 导入照片并进入编辑器，等图像加载完成 */
async function openPhoto(page: Page): Promise<void> {
  await page.goto('/')
  const photoB64 = await makePhoto(page)
  await page.locator('input[type=file]').setInputFiles({ name: `${PHOTO_NAME}.png`, mimeType: 'image/png', buffer: Buffer.from(photoB64, 'base64') })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()
}

/** 舞台画布上一块矩形区域（相对舞台的 CSS 像素）里非透明像素的个数；照片之外的空白处只有笔刷圆圈会画出像素 */
function paintedPixels(page: Page, rect: { left: number, top: number, width: number, height: number }): Promise<number> {
  return page.evaluate(({ left, top, width, height }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!
    const ratio = canvas.width / canvas.clientWidth
    const { data } = canvas.getContext('2d')!.getImageData(
      Math.round(left * ratio),
      Math.round(top * ratio),
      Math.round(width * ratio),
      Math.round(height * ratio)
    )
    let painted = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! > 0) painted++
    }
    return painted
  }, rect)
}

test.beforeEach(({ page }) => skipSetupWizard(page))

test('裁剪后画笔圆圈在裁剪框之外照样跟着指针；系统光标保持可见，指针移出画布后圆圈消失', async ({ page }) => {
  // 视角过渡会让照片在几百毫秒内移动，减少动态效果时直接到位，取样位置才稳定
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openPhoto(page)
  await page.getByRole('tab', { name: /图层/ }).click()
  await page.getByRole('button', { name: '调整图层' }).click()
  await expect(page.getByRole('heading', { name: '调整 1' })).toBeVisible()

  // 裁剪后的照片适应窗口，舞台四周只剩 24px 的空白边；左边这条空白条一定在裁剪框之外
  await page.keyboard.press('c')
  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: '1:1' }).click()
  await page.getByRole('button', { name: '完成' }).click()
  await page.keyboard.press('b')

  const stage = page.locator('.konvajs-content')
  const box = (await stage.boundingBox())!
  const pointerY = Math.round(box.height / 2)
  // 指针贴在舞台左边缘，圆圈半径（画笔 3% × 缩放）远大于空白边，圆弧必然划过这条空白条
  const margin = { left: 0, top: pointerY - 40, width: 20, height: 80 }

  // 指针不在画布上时空白条里什么都没画；指针移到裁剪框之外后圆圈画了出来，系统光标始终可见（十字，不能隐藏）
  expect(await paintedPixels(page, margin)).toBe(0)
  await page.mouse.move(box.x + 6, box.y + pointerY, { steps: 4 })
  await expect.poll(() => paintedPixels(page, margin)).toBeGreaterThan(0)
  await expect(stage).toHaveCSS('cursor', 'crosshair')

  // 移出画布：圆圈消失
  await page.mouse.move(box.x + box.width / 2, box.y - 20, { steps: 4 })
  await expect.poll(() => paintedPixels(page, margin)).toBe(0)
})

test('单击照片外的空白处取消选中图层；点在照片上、拖动平移、中键、右键、裁剪工具下都不取消', async ({ page }) => {
  await openPhoto(page)

  await page.getByRole('tab', { name: /图层/ }).click()
  await page.getByRole('button', { name: '调整图层' }).click()
  const selected = page.locator('[aria-current="true"]')
  const heading = page.getByRole('heading', { name: '调整 1' })
  await expect(selected).toHaveCount(1)
  await expect(heading).toBeVisible()
  // 渐变区域：画布上有端点手柄和延伸到照片之外的参考线，单击空白处仍然取消选中
  await page.getByRole('button', { name: '渐变' }).click()
  await expect(page.getByText('拖动画布上的两个端点')).toBeVisible()

  const stage = page.locator('.konvajs-content')
  const blank = { x: 6, y: 6 }
  const box = (await stage.boundingBox())!

  // 点在照片上（避开渐变的手柄，终点手柄正好在照片中心）：不取消
  await stage.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } })
  await expect(selected).toHaveCount(1)

  // 在空白处按下并拖动是平移画布：不取消
  await page.mouse.move(box.x + blank.x, box.y + blank.y)
  await page.mouse.down()
  await page.mouse.move(box.x + blank.x + 70, box.y + blank.y + 40, { steps: 8 })
  await page.mouse.up()
  await expect(selected).toHaveCount(1)

  // 中键、右键点空白处：不取消，右键照常弹出画布菜单
  await stage.click({ button: 'middle', position: blank })
  await expect(selected).toHaveCount(1)
  await stage.click({ button: 'right', position: blank })
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(selected).toHaveCount(1)

  // 裁剪时检查器显示的是裁剪面板，选中的图层不可见，点空白处不能悄悄取消它
  await page.keyboard.press('c')
  await expect(page.getByRole('heading', { name: '裁剪与校正' })).toBeVisible()
  await stage.click({ position: blank })
  await expect(selected).toHaveCount(1)
  await page.keyboard.press('v')
  await expect(heading).toBeVisible()

  // 选择工具下单击空白处：取消选中，检查器回到空状态
  await stage.click({ position: blank })
  await expect(selected).toHaveCount(0)
  await expect(heading).toBeHidden()
  await expect(page.getByText('未选择图层')).toBeVisible()

  // 图层列表里重新选中
  await layerRow(page, '调整 1').click()
  await expect(selected).toHaveCount(1)
  await expect(heading).toBeVisible()
})
