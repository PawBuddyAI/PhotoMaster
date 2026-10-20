import { suppressNativeContextMenu } from '~/lib/context-menu'

/** 网页版与桌面版都只显示应用自己的右键菜单，其余位置不弹出浏览器自带的菜单（保留的例外见 lib/context-menu.ts） */
export default defineNuxtPlugin(() => {
  suppressNativeContextMenu(window)
})
