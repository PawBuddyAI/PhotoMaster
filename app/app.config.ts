export default defineAppConfig({
  ui: {
    colors: {
      primary: 'violet',
      neutral: 'zinc'
    },
    button: {
      // 按钮默认 lg：带文字的按钮不小于 lg，同排的图标按钮高度与之一致；更紧凑的图标按钮需显式指定 size
      defaultVariants: {
        size: 'lg'
      }
    }
  }
})
