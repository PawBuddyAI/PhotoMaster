<script setup lang="ts">
/**
 * 系统设置式的一行：标签与说明在左，控件在右；窄屏时控件换到下方。
 * toggle 行（开关）在窄屏也保持同一行。
 */
withDefaults(defineProps<{
  label: string
  description?: string
  toggle?: boolean
}>(), {
  description: undefined,
  toggle: false
})
</script>

<template>
  <UFormField
    :label="label"
    :description="description"
    orientation="horizontal"
    :ui="{
      root: toggle
        ? 'flex-row items-center justify-between gap-4 px-4 py-3'
        : 'flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-6',
      wrapper: 'min-w-0 flex-1',
      label: 'text-sm font-normal text-highlighted',
      description: 'mt-0.5 text-xs text-pretty text-muted',
      container: toggle ? 'shrink-0' : 'w-full shrink-0 sm:w-72'
    }"
  >
    <slot />
  </UFormField>
</template>
