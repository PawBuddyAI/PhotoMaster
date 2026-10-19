<script setup lang="ts">
/** 工程列表与设置共用的窗口外壳：毛玻璃导航侧栏 + 内容区；侧栏背后的照片底图由 app.vue 常驻渲染 */
const colorMode = useColorMode()

const navItems = [
  { label: '工程', icon: 'i-lucide-images', to: '/' },
  { label: '设置', icon: 'i-lucide-settings', to: '/settings' }
]

const appearanceItems = [
  { value: 'system', label: '跟随系统', icon: 'i-lucide-monitor' },
  { value: 'light', label: '浅色', icon: 'i-lucide-sun' },
  { value: 'dark', label: '深色', icon: 'i-lucide-moon' }
]
</script>

<template>
  <UDashboardGroup
    unit="rem"
    storage="local"
    storage-key="apm-shell"
  >
    <UDashboardSidebar
      id="app-nav"
      :default-size="14"
    >
      <template #header>
        <NuxtLink
          to="/"
          class="flex items-center gap-2 rounded-lg outline-primary/60 focus-visible:outline-2"
        >
          <UIcon
            name="i-lucide-aperture"
            class="size-5 text-muted"
          />
          <span class="text-[17px] font-semibold text-highlighted">AI 修图</span>
        </NuxtLink>
      </template>

      <nav
        aria-label="主导航"
        class="flex flex-col gap-0.5"
      >
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          v-slot="{ href, navigate, isExactActive }"
          :to="item.to"
          custom
        >
          <a
            :href="href"
            :aria-current="isExactActive ? 'page' : undefined"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-primary/60 transition-colors duration-200 ease-out focus-visible:outline-2"
            :class="isExactActive ? 'bg-(--mac-selected) text-highlighted' : 'text-muted hover:bg-elevated hover:text-highlighted'"
            @click="navigate"
          >
            <UIcon
              :name="item.icon"
              class="size-4.5 shrink-0"
              :class="isExactActive ? 'text-primary' : ''"
            />
            {{ item.label }}
          </a>
        </NuxtLink>
      </nav>

      <template #footer>
        <div class="flex w-full items-center justify-between gap-2">
          <span class="text-xs text-muted">外观</span>
          <div
            role="group"
            aria-label="外观"
            class="flex gap-0.5 rounded-lg p-0.5 ring ring-default ring-inset"
          >
            <UTooltip
              v-for="item in appearanceItems"
              :key="item.value"
              :text="item.label"
            >
              <UButton
                :icon="item.icon"
                size="sm"
                :color="colorMode.preference === item.value ? 'primary' : 'neutral'"
                :variant="colorMode.preference === item.value ? 'soft' : 'ghost'"
                :aria-label="item.label"
                :aria-pressed="colorMode.preference === item.value"
                @click="colorMode.preference = item.value"
              />
            </UTooltip>
          </div>
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
