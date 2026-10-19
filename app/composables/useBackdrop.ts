/** 窗口底图：毛玻璃侧栏背后透出的照片。页面写入当前照片的缩略图，外壳负责渲染 */
export function useBackdrop() {
  return useState<Blob | null>('backdrop', () => null)
}
