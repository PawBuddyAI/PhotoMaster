<script setup lang="ts">
/**
 * 相册图标：「照片封面」（不用 emoji，侧栏显示相册里最近修改的那张照片）加按类别分组的常用 emoji。
 * 每个类别是一个单选组，共用同一个值：Tab 每组只停一次，组内用左右方向键按顺序移动；选项太多，放在可滚动区域里。
 * emoji 自带颜色，选中项除了选中底再加一圈系统蓝描边
 */
const model = defineModel<string | null>({ required: true })

/** 单选组的值不能是 null，用空字符串代表照片封面 */
const COVER = ''

const GROUPS: Array<{ label: string, items: Array<{ value: string, label: string }> }> = [
  {
    label: '常用',
    items: [
      { value: COVER, label: '照片封面' },
      { value: '❤️', label: '爱心' },
      { value: '⭐', label: '星标' },
      { value: '✨', label: '闪光' },
      { value: '🔥', label: '火焰' },
      { value: '🌈', label: '彩虹' },
      { value: '📷', label: '相机' },
      { value: '🎨', label: '创作' },
      { value: '🎬', label: '电影' },
      { value: '🎵', label: '音乐' },
      { value: '📚', label: '读书' },
      { value: '🏠', label: '家' }
    ]
  },
  {
    label: '人物',
    items: [
      { value: '👨‍👩‍👧', label: '家人' },
      { value: '👶', label: '宝宝' },
      { value: '👧', label: '女孩' },
      { value: '👦', label: '男孩' },
      { value: '👩', label: '女士' },
      { value: '👨', label: '男士' },
      { value: '👵', label: '奶奶' },
      { value: '👴', label: '爷爷' },
      { value: '💑', label: '情侣' },
      { value: '💍', label: '婚礼' },
      { value: '🎓', label: '毕业' },
      { value: '🤳', label: '自拍' }
    ]
  },
  {
    label: '动物',
    items: [
      { value: '🐱', label: '猫' },
      { value: '🐶', label: '狗' },
      { value: '🐰', label: '兔子' },
      { value: '🐹', label: '仓鼠' },
      { value: '🐭', label: '老鼠' },
      { value: '🐼', label: '熊猫' },
      { value: '🐨', label: '考拉' },
      { value: '🦊', label: '狐狸' },
      { value: '🐻', label: '熊' },
      { value: '🐯', label: '老虎' },
      { value: '🦁', label: '狮子' },
      { value: '🐮', label: '奶牛' },
      { value: '🐷', label: '猪' },
      { value: '🐸', label: '青蛙' },
      { value: '🐵', label: '猴子' },
      { value: '🐔', label: '鸡' },
      { value: '🐧', label: '企鹅' },
      { value: '🐦', label: '小鸟' },
      { value: '🦉', label: '猫头鹰' },
      { value: '🦆', label: '鸭子' },
      { value: '🦜', label: '鹦鹉' },
      { value: '🦢', label: '天鹅' },
      { value: '🦩', label: '火烈鸟' },
      { value: '🦋', label: '蝴蝶' },
      { value: '🐝', label: '蜜蜂' },
      { value: '🐞', label: '瓢虫' },
      { value: '🐢', label: '乌龟' },
      { value: '🐠', label: '热带鱼' },
      { value: '🐬', label: '海豚' },
      { value: '🐳', label: '鲸鱼' },
      { value: '🦀', label: '螃蟹' },
      { value: '🐙', label: '章鱼' },
      { value: '🐘', label: '大象' },
      { value: '🦒', label: '长颈鹿' },
      { value: '🦓', label: '斑马' },
      { value: '🐴', label: '马' },
      { value: '🐑', label: '绵羊' },
      { value: '🐿️', label: '松鼠' },
      { value: '🦔', label: '刺猬' },
      { value: '🦄', label: '独角兽' }
    ]
  },
  {
    label: '自然',
    items: [
      { value: '🌸', label: '樱花' },
      { value: '🌷', label: '郁金香' },
      { value: '🌻', label: '向日葵' },
      { value: '🌹', label: '玫瑰' },
      { value: '🍀', label: '四叶草' },
      { value: '🌵', label: '仙人掌' },
      { value: '🌲', label: '松树' },
      { value: '🌴', label: '椰树' },
      { value: '🍁', label: '枫叶' },
      { value: '🍂', label: '落叶' },
      { value: '🌊', label: '海浪' },
      { value: '☀️', label: '太阳' },
      { value: '🌙', label: '月亮' },
      { value: '❄️', label: '雪花' },
      { value: '⛅', label: '多云' }
    ]
  },
  {
    label: '旅行',
    items: [
      { value: '✈️', label: '旅行' },
      { value: '🏖️', label: '海边' },
      { value: '🏝️', label: '海岛' },
      { value: '🏔️', label: '雪山' },
      { value: '🏕️', label: '露营' },
      { value: '🏙️', label: '城市' },
      { value: '🌃', label: '夜景' },
      { value: '🌅', label: '日出' },
      { value: '🗼', label: '铁塔' },
      { value: '🏰', label: '城堡' },
      { value: '🎡', label: '摩天轮' },
      { value: '🚗', label: '自驾' },
      { value: '🚄', label: '高铁' },
      { value: '🚲', label: '骑行' },
      { value: '⛵', label: '帆船' },
      { value: '🗺️', label: '地图' },
      { value: '🧳', label: '行李' }
    ]
  },
  {
    label: '美食',
    items: [
      { value: '🍜', label: '面条' },
      { value: '🍣', label: '寿司' },
      { value: '🍱', label: '便当' },
      { value: '🥟', label: '饺子' },
      { value: '🍲', label: '火锅' },
      { value: '🍕', label: '披萨' },
      { value: '🍔', label: '汉堡' },
      { value: '🍰', label: '蛋糕' },
      { value: '🍦', label: '冰淇淋' },
      { value: '🍩', label: '甜甜圈' },
      { value: '🍓', label: '草莓' },
      { value: '🍉', label: '西瓜' },
      { value: '🍑', label: '桃子' },
      { value: '☕', label: '咖啡' },
      { value: '🍵', label: '茶' },
      { value: '🍺', label: '啤酒' },
      { value: '🍷', label: '红酒' }
    ]
  },
  {
    label: '节日与运动',
    items: [
      { value: '🎂', label: '生日' },
      { value: '🎉', label: '聚会' },
      { value: '🎁', label: '礼物' },
      { value: '🎄', label: '圣诞' },
      { value: '🎃', label: '万圣节' },
      { value: '🧧', label: '红包' },
      { value: '🏮', label: '灯笼' },
      { value: '🎆', label: '烟花' },
      { value: '🎈', label: '气球' },
      { value: '⚽', label: '足球' },
      { value: '🏀', label: '篮球' },
      { value: '🏸', label: '羽毛球' },
      { value: '🏊', label: '游泳' },
      { value: '🏃', label: '跑步' },
      { value: '⛷️', label: '滑雪' },
      { value: '🎮', label: '游戏' },
      { value: '🎤', label: '唱歌' }
    ]
  }
]

const value = computed({
  get: () => model.value ?? COVER,
  set: (next: string) => {
    model.value = next === COVER ? null : next
  }
})

const scroller = useTemplateRef('scroller')

// 弹窗每次打开都重新挂载：已选的 emoji 可能在靠下的分组里，先滚到能看见它
onMounted(() => {
  scroller.value?.querySelector('[data-state=checked]')?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <div
    ref="scroller"
    class="-mx-1 flex max-h-[min(20rem,45vh)] flex-col gap-3 overflow-y-auto p-1"
  >
    <URadioGroup
      v-for="group in GROUPS"
      :key="group.label"
      v-model="value"
      :legend="group.label"
      :items="group.items"
      variant="card"
      indicator="hidden"
      orientation="horizontal"
      :ui="{
        fieldset: 'grid grid-cols-7 gap-1 sm:grid-cols-10',
        legend: 'mb-1.5 text-xs font-medium text-muted',
        item: 'aspect-square cursor-pointer items-center justify-center rounded-lg border-transparent p-0 outline-primary/60 duration-200 ease-out hover:not-has-data-[state=checked]:bg-elevated has-focus-visible:outline-2 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-(--mac-selected)'
      }"
    >
      <template #label="{ item }">
        <UTooltip
          v-if="item.value === COVER"
          text="照片封面"
        >
          <UIcon
            name="i-lucide-image"
            aria-hidden="true"
            class="size-5"
            :class="value === COVER ? 'text-primary' : 'text-muted'"
          />
        </UTooltip>
        <!-- Reka 用标签的 innerText 作为单选按钮的 aria-label；emoji 用伪元素画出来，不算进 innerText，读屏只读中文名 -->
        <span
          v-else
          aria-hidden="true"
          :data-emoji="item.value"
          class="text-xl leading-none before:content-[attr(data-emoji)]"
        />
        <span class="sr-only">{{ item.label }}</span>
      </template>
    </URadioGroup>
  </div>
</template>
