<script setup lang="ts">
import { shouldConfirmOnEnter } from '~/lib/dialog'

/**
 * 弹窗底部的按钮行：「取消」在左（分步弹窗里可改成「返回」等），确认在右，放进 UModal 的 footer 插槽。
 * 普通确认是系统蓝实心按钮，也是弹窗的默认按钮：焦点在弹窗里的输入框、单选项、滑块上或停在弹窗本身时，回车即确认；
 * 焦点在其他按钮、多行文本或下拉框上时，回车留给它们自己。
 * 危险确认（删除）是凸起灰底红字，回车不触发，避免误删。
 */
const props = withDefaults(defineProps<{
  confirmLabel: string
  confirmIcon?: string
  cancelLabel?: string
  /** 危险操作：红字按钮，不响应回车 */
  danger?: boolean
  disabled?: boolean
  /** 确认进行中：确认按钮转圈，两个按钮都不可点 */
  loading?: boolean
}>(), {
  confirmIcon: undefined,
  cancelLabel: '取消',
  danger: false,
  disabled: false,
  loading: false
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const root = ref<HTMLElement | null>(null)
let dialog: HTMLElement | null = null
let focusTimer: ReturnType<typeof setTimeout> | undefined

function onKeydown(event: KeyboardEvent) {
  if (props.danger || props.disabled || props.loading || !shouldConfirmOnEnter(event)) {
    return
  }
  event.preventDefault()
  emit('confirm')
}

onMounted(() => {
  dialog = root.value?.closest<HTMLElement>('[role="dialog"]') ?? null
  dialog?.addEventListener('keydown', onKeydown)
  // Reka 打开弹窗时把焦点交给第一个可聚焦元素，通常是标题栏的关闭按钮，这时回车会直接关掉弹窗。
  // 等它（以及输入框的 autofocus）落定后，若焦点仍停在关闭按钮上，改交给弹窗本身，回车才是确认
  if (!props.danger) {
    focusTimer = setTimeout(() => {
      if (dialog && document.activeElement === dialog.querySelector('[data-slot="close"]')) {
        dialog.focus()
      }
    })
  }
})

onBeforeUnmount(() => {
  clearTimeout(focusTimer)
  dialog?.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    ref="root"
    class="flex w-full justify-end gap-2"
  >
    <UButton
      :label="cancelLabel"
      color="neutral"
      variant="ghost"
      :disabled="loading"
      @click="emit('cancel')"
    />
    <UButton
      :icon="confirmIcon"
      :label="confirmLabel"
      :color="danger ? 'error' : 'secondary'"
      :disabled="disabled"
      :loading="loading"
      @click="emit('confirm')"
    />
  </div>
</template>
