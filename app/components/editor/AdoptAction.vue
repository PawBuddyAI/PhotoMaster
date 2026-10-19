<script setup lang="ts">
/** 建议卡片右上角的采纳操作：未采纳时是按钮，采纳后变成不可交互的状态标签 */
defineProps<{ adopted: boolean }>()
defineEmits<{ adopt: [] }>()
</script>

<template>
  <span
    v-if="adopted"
    class="flex h-9 shrink-0 items-center gap-1 px-1 text-sm text-muted"
  >
    <UIcon
      name="i-lucide-check"
      class="size-4"
    />
    已采纳
  </span>
  <UButton
    v-else
    label="采纳"
    color="neutral"
    variant="outline"
    @click="$emit('adopt')"
  />
</template>
