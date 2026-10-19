<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  min: number
  max: number
  step?: number
  /** 双击标签或滑块时恢复的值 */
  defaultValue?: number
  format?: (value: number) => string
  hint?: string
  disabled?: boolean
}>(), {
  step: 1,
  defaultValue: 0,
  format: undefined,
  hint: undefined
})

const model = defineModel<number>({ required: true })

const display = computed(() => {
  if (props.format) {
    return props.format(model.value)
  }
  return props.step < 1 ? model.value.toFixed(2) : String(Math.round(model.value))
})

/**
 * 填充段的起止位置：跨零的双极参数（曝光、对比度、水平校正等）从 0 向两侧填充，
 * 单极参数（强度、羽化、笔刷）从最小值填充；未改动的双极参数没有填充，强调色只标出改过的值
 */
const fillStyle = computed(() => {
  const span = props.max - props.min || 1
  const anchor = props.min < 0 && props.max > 0 ? 0 : props.min
  const lo = Math.min(model.value, anchor)
  const hi = Math.max(model.value, anchor)
  return {
    '--fill-start': `${((lo - props.min) / span) * 100}%`,
    '--fill-end': `${((props.max - hi) / span) * 100}%`
  }
})

function reset() {
  if (!props.disabled) {
    model.value = props.defaultValue
  }
}
</script>

<template>
  <div
    class="space-y-1.5"
    :style="fillStyle"
  >
    <div class="flex items-center justify-between text-xs">
      <UTooltip
        :text="hint ? `${hint}（双击复位）` : '双击复位'"
        :delay-duration="600"
      >
        <button
          type="button"
          class="rounded-sm text-muted outline-primary/60 transition-colors duration-200 ease-out hover:text-highlighted focus-visible:outline-2"
          @dblclick="reset"
        >
          {{ label }}
        </button>
      </UTooltip>
      <span
        class="tabular-nums"
        :class="model !== defaultValue ? 'font-medium text-highlighted' : 'text-dimmed'"
      >{{ display }}</span>
    </div>
    <USlider
      v-model="model"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      size="sm"
      :aria-label="label"
      :aria-valuetext="display"
      :ui="{ range: 'right-(--fill-end)! left-(--fill-start)!' }"
      @dblclick="reset"
    />
  </div>
</template>
