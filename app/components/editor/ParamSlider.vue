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

function reset() {
  if (!props.disabled) {
    model.value = props.defaultValue
  }
}
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center justify-between text-xs">
      <UTooltip
        :text="hint ? `${hint}（双击复位）` : '双击复位'"
        :delay-duration="600"
      >
        <button
          type="button"
          class="text-muted transition hover:text-default"
          @dblclick="reset"
        >
          {{ label }}
        </button>
      </UTooltip>
      <span
        class="tabular-nums"
        :class="model !== defaultValue ? 'text-primary' : 'text-dimmed'"
      >{{ display }}</span>
    </div>
    <USlider
      v-model="model"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      size="sm"
      @dblclick="reset"
    />
  </div>
</template>
