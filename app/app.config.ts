/**
 * macOS Vibrancy 组件主题。
 * 颜色全部来自 main.css 的三级深度令牌：deep（侧栏、凹槽）→ mid（面板、卡片）→ surface（按钮）。
 * 强调色只标记交互状态（焦点、选中工具、滑块填充、开关开启），从不做按钮或面板底色；
 * 过渡只作用于颜色，浮层不做缩放、滑动动画。
 */
const ALL_COLORS = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']
const STATUS_COLORS = ['primary', 'secondary', 'success', 'info', 'warning', 'error']

const RAISED = 'bg-surface ring ring-inset ring-default hover:bg-(--mac-surface-hover) active:bg-surface disabled:bg-surface aria-disabled:bg-surface'
const OVERLAY_SHADOW = 'shadow-[0_2px_8px_rgba(0,0,0,0.3)]'
const NO_ANIMATION = 'data-[state=open]:animate-none data-[state=closed]:animate-none'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'neutral'
    },
    button: {
      slots: {
        base: 'rounded-lg duration-200 ease-out disabled:opacity-50 aria-disabled:opacity-50'
      },
      // 按钮默认 lg：带文字的按钮不小于 lg，同排的图标按钮高度与之一致；更紧凑的图标按钮需显式指定 size
      defaultVariants: {
        size: 'lg'
      },
      compoundVariants: [
        // 主按钮：凸起灰填充，不用强调色做底
        { color: ['primary', 'neutral'], variant: 'solid', class: `${RAISED} text-highlighted` },
        // 危险、警示操作沿用凸起底，语义色只落在文字上
        { color: 'error', variant: 'solid', class: `${RAISED} text-error` },
        { color: 'warning', variant: 'solid', class: `${RAISED} text-warning` },
        // 次按钮：透明底 + 1px 描边
        { color: 'neutral', variant: ['outline', 'subtle'], class: 'bg-transparent text-muted ring-accented hover:bg-elevated hover:text-highlighted active:bg-elevated disabled:bg-transparent aria-disabled:bg-transparent' },
        { color: 'neutral', variant: 'ghost', class: 'text-muted hover:bg-elevated hover:text-highlighted active:bg-elevated disabled:bg-transparent aria-disabled:bg-transparent' },
        { color: 'neutral', variant: 'link', class: 'text-muted hover:text-highlighted active:text-highlighted' },
        { color: 'neutral', variant: 'soft', class: 'bg-(--mac-selected) text-highlighted hover:bg-(--mac-selected) active:bg-(--mac-selected)' },
        // 选中态：浅色选中底 + 强调色图标，与侧栏激活项一致
        { color: 'primary', variant: 'soft', class: 'bg-(--mac-selected) text-primary hover:bg-(--mac-selected) active:bg-(--mac-selected) disabled:bg-transparent aria-disabled:bg-transparent' },
        { color: 'primary', variant: 'ghost', class: 'text-primary hover:bg-elevated active:bg-elevated' },
        { color: 'primary', variant: 'outline', class: 'ring-accented hover:bg-elevated active:bg-elevated' },
        // 焦点环统一为 2px 强调色
        { color: ALL_COLORS, variant: ['solid', 'outline', 'soft', 'subtle', 'ghost', 'link'], class: 'outline-primary/60 focus-visible:outline-2' }
      ]
    },
    input: {
      slots: { base: 'rounded-lg duration-200 ease-out' },
      variants: { variant: { outline: 'bg-field ring-accented' } },
      compoundVariants: [{ color: 'primary', variant: ['outline', 'subtle'], class: 'focus-visible:ring-primary/60' }]
    },
    textarea: {
      slots: { base: 'rounded-lg duration-200 ease-out' },
      variants: { variant: { outline: 'bg-field ring-accented' } },
      compoundVariants: [{ color: 'primary', variant: ['outline', 'subtle'], class: 'focus-visible:ring-primary/60' }]
    },
    inputNumber: {
      slots: { base: 'rounded-lg duration-200 ease-out' },
      variants: { variant: { outline: 'bg-field ring-accented' } },
      compoundVariants: [{ color: 'primary', variant: ['outline', 'subtle'], class: 'focus-visible:ring-primary/60' }]
    },
    select: {
      slots: {
        base: 'rounded-lg duration-200 ease-out',
        // 下拉菜单与 macOS 菜单一样半透明模糊
        content: `rounded-lg bg-default/85 backdrop-blur-xl ${OVERLAY_SHADOW}`,
        item: 'before:rounded-md data-highlighted:not-data-disabled:before:bg-(--mac-selected)'
      },
      variants: {
        variant: { outline: 'bg-field ring-accented' },
        transition: { true: { content: NO_ANIMATION } }
      },
      compoundVariants: [{ color: 'primary', variant: ['outline', 'subtle'], class: 'focus-visible:ring-primary/60' }]
    },
    // 可输入的下拉框（模型名称）与 select 外观一致；它的展开动画写在 content 上，没有 transition 变体
    inputMenu: {
      slots: {
        base: 'rounded-lg duration-200 ease-out',
        content: `rounded-lg bg-default/85 backdrop-blur-xl ${OVERLAY_SHADOW} ${NO_ANIMATION}`,
        item: 'before:rounded-md data-highlighted:not-data-disabled:before:bg-(--mac-selected)'
      },
      variants: { variant: { outline: 'bg-field ring-accented' } },
      compoundVariants: [{ color: 'primary', variant: ['outline', 'subtle'], class: 'focus-visible:ring-primary/60' }]
    },
    switch: {
      slots: {
        // 用 2px 内边距代替 2px 透明边框，保持几何尺寸不变
        base: 'rounded-xl border-0 p-0.5 focus-visible:outline-2',
        thumb: 'rounded-xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-none'
      },
      variants: { color: { primary: { base: 'outline-primary/60' } } }
    },
    slider: {
      slots: {
        track: 'rounded-xl',
        range: 'rounded-xl',
        thumb: 'rounded-xl bg-white ring-1 shadow-[0_1px_2px_rgba(0,0,0,0.35)] focus-visible:outline-2 focus-visible:outline-offset-0'
      },
      variants: { color: { primary: { thumb: 'ring-black/15 outline-primary/60' } } }
    },
    progress: {
      slots: { base: 'rounded-xl', indicator: 'rounded-xl' }
    },
    tooltip: {
      slots: {
        content: `rounded-md bg-mid ring-default ${OVERLAY_SHADOW} data-[state=delayed-open]:animate-none data-[state=closed]:animate-none`
      }
    },
    modal: {
      slots: {
        title: 'text-[17px]'
      },
      variants: {
        fullscreen: { false: { content: `rounded-xl ${OVERLAY_SHADOW}` } },
        overlay: { true: { overlay: 'bg-(--mac-scrim)' } },
        transition: { true: { overlay: NO_ANIMATION, content: NO_ANIMATION } }
      }
    },
    toast: {
      slots: { root: `rounded-xl bg-default/85 backdrop-blur-xl ${OVERLAY_SHADOW}` }
    },
    alert: {
      slots: { root: 'rounded-xl', title: 'text-highlighted', description: 'text-muted opacity-100' },
      // 提示条是中性卡片，语义色只用在图标上
      compoundVariants: [
        ...STATUS_COLORS.map(color => ({ color, variant: ['subtle', 'outline', 'soft'], class: { root: 'bg-default text-default ring ring-inset ring-default', icon: `text-${color}` } })),
        { color: 'neutral', variant: ['subtle', 'outline', 'soft'], class: { root: 'bg-default text-default ring ring-inset ring-default', icon: 'text-muted' } }
      ]
    },
    badge: {
      slots: { base: 'rounded-md' },
      // 徽章不铺强调色底：状态色只用于文字，外框用中性发丝线
      compoundVariants: [
        { color: STATUS_COLORS, variant: ['subtle', 'outline'], class: 'bg-transparent ring-accented' },
        { color: STATUS_COLORS, variant: 'soft', class: 'bg-elevated' },
        { color: 'neutral', variant: ['subtle', 'outline'], class: 'bg-transparent text-muted' }
      ]
    },
    avatar: {
      slots: { root: 'rounded-xl' }
    },
    empty: {
      slots: { title: 'font-semibold' },
      variants: { variant: { outline: { root: 'bg-transparent ring-0' } } }
    },
    card: {
      slots: { root: 'rounded-xl' }
    },
    dashboardPanel: {
      slots: { root: 'bg-default' }
    },
    dashboardSidebar: {
      variants: {
        side: {
          // 左栏是毛玻璃：底层照片的色调会透出来
          left: { root: 'bg-deep/80 backdrop-blur-xl' },
          right: { root: 'border-s border-default bg-default' }
        }
      }
    },
    dashboardNavbar: {
      slots: { title: 'text-[17px]' }
    }
  }
})
