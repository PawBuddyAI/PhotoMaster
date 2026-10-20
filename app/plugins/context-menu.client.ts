import { isDesktop, suppressNativeContextMenu } from '~/lib/desktop'

/**
 * 桌面版只显示应用自己的右键菜单（工程卡片、侧栏相册、图层、画布），其余位置不弹出 WebView 自带的浏览器菜单。
 * 网页版保留浏览器菜单：那里的「在新标签页中打开」「复制图片」等仍然有用
 */
export default defineNuxtPlugin(() => {
  if (isDesktop()) {
    suppressNativeContextMenu(window)
  }
})
