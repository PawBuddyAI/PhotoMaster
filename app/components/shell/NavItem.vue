<script setup lang="ts">
/**
 * 毛玻璃侧栏里的一行导航：图标、相册的 emoji 或封面，名称，可选的数量。当前页为选中底 + 高亮文字 + 系统蓝图标。
 * 相册的 emoji 优先于封面；两者都没有时显示图标。拖着工程卡片停在这一行上时（dropping）描一圈系统蓝，与右键菜单打开时的描边一致
 */
// 根节点是 NuxtLink 的 custom 模式，渲染为片段，透传属性落不到链接上；
// 显式绑到 <a>，右键菜单（as-child 触发器）的监听与 data-state 才能挂在这一行上
defineOptions({ inheritAttrs: false })

defineProps<{
  to: string
  label: string
  icon: string
  emoji?: string
  /** 相册封面（相册里最近修改的那张照片）；空相册没有封面 */
  cover?: string | null
  count?: number
  dropping?: boolean
}>()
</script>

<template>
  <NuxtLink
    v-slot="{ href, navigate, isExactActive }"
    :to="to"
    custom
  >
    <a
      v-bind="$attrs"
      :href="href"
      :aria-current="isExactActive ? 'page' : undefined"
      :data-dropping="dropping || undefined"
      class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-primary/60 transition-colors duration-200 ease-out focus-visible:outline-2 data-[dropping]:outline-2 data-[dropping]:outline-primary data-[state=open]:outline-2 data-[state=open]:outline-primary"
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
