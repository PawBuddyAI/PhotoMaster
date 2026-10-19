/**
 * TransitionGroup 的 before-leave 钩子：把离场元素钉在原位并移出文档流，
 * 其余条目立即开始让位（FLIP），离场元素在原地淡出。容器必须是定位元素（relative）。
 * 列表与网格通用：位置取自 offsetLeft/offsetTop，而不是依赖 static position。
 */
export function pinLeaving(el: Element): void {
  const node = el as HTMLElement
  const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = node
  Object.assign(node.style, {
    position: 'absolute',
    left: `${offsetLeft}px`,
    top: `${offsetTop}px`,
    width: `${offsetWidth}px`,
    height: `${offsetHeight}px`
  })
}
