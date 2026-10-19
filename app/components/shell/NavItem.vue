<script setup lang="ts">
/**
 * 毛玻璃侧栏里的一行导航：图标、相册的 emoji 或封面，名称，可选的数量。当前页为选中底 + 高亮文字 + 强调色图标。
 * 相册的 emoji 优先于封面；两者都没有时显示图标
 */
defineProps<{
  to: string
  label: string
  icon: string
  emoji?: string
  /** 相册封面（相册里最近修改的那张照片）；空相册没有封面 */
  cover?: string | null
  count?: number
}>()
</script>

<template>
  <NuxtLink
    v-slot="{ href, navigate, isExactActive }"
    :to="to"
    custom
  >
    <a
      :href="href"
      :aria-current="isExactActive ? 'page' : undefined"
      class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-primary/60 transition-colors duration-200 ease-out focus-visible:outline-2"
      :class="isExactActive ? 'bg-(--mac-selected) text-highlighted' : 'text-muted hover:bg-elevated hover:text-highlighted'"
      @click="navigate"
    >
      <span
        v-if="emoji"
        aria-hidden="true"
        class="flex size-4.5 shrink-0 items-center justify-center text-[15px] leading-none"
      >{{ emoji }}</span>
      <img
        v-else-if="cover"
        :src="cover"
        alt=""
        class="size-4.5 shrink-0 rounded-sm object-cover"
      >
      <UIcon
        v-else
        :name="icon"
        class="size-4.5 shrink-0"
        :class="isExactActive ? 'text-primary' : ''"
      />
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <span
        v-if="count !== undefined"
        class="shrink-0 text-xs text-muted tabular-nums"
      >{{ count }}</span>
    </a>
  </NuxtLink>
</template>
