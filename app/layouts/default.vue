<script setup lang="ts">
import { useLibraryStore } from '~/stores/library'

/**
 * 图库、相册与设置共用的窗口外壳：毛玻璃导航侧栏 + 内容区；侧栏背后的照片底图由 app.vue 常驻渲染。
 * 侧栏按 macOS「照片」的结构排列：图库在上，相册分组其次，设置与外观收在底部。
 * 工程与相册数据在这里读取一次，侧栏和各页面共用；从编辑器返回时外壳重新挂载，列表随之刷新。
 */
const colorMode = useColorMode()
const library = useLibraryStore()
const notify = useNotify()
const router = useRouter()
const backdrop = useBackdrop()

const appearanceItems = [
  { value: 'system', label: '跟随系统', icon: 'i-lucide-monitor' },
  { value: 'light', label: '浅色', icon: 'i-lucide-sun' },
  { value: 'dark', label: '深色', icon: 'i-lucide-moon' }
]

/** 正在侧栏里新建的相册名称；null 表示没有在新建 */
const draftName = ref<string | null>(null)

onMounted(async () => {
  try {
    await library.refresh()
    // 图库页与相册页各自决定透出哪张照片；直接打开设置页时还没有底图，用最近修过的那张，侧栏不会是一片纯灰
    backdrop.value ??= library.projects[0]?.thumbnail ?? null
  } catch (err) {
    notify.error(err)
  }
})

/** 回车与失焦都会提交：先清空草稿，输入框卸载时再触发的失焦就不会重复创建 */
async function commitDraft() {
  const name = draftName.value
  draftName.value = null
  if (!name?.trim()) {
    return
  }
  try {
    const album = await library.addAlbum(name)
    if (album) {
      await router.push(`/albums/${album.id}`)
    }
  } catch (err) {
    notify.error(err)
  }
}
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
        class="flex flex-col gap-5"
      >
        <ShellNavItem
          to="/"
          label="图库"
          icon="i-lucide-images"
          :count="library.loaded ? library.projects.length : undefined"
        />

        <section
          aria-labelledby="albums-heading"
          class="flex flex-col gap-0.5"
        >
          <div class="flex items-center justify-between gap-2 ps-2.5">
            <h2
              id="albums-heading"
              class="text-xs font-medium text-muted"
            >
              相册
            </h2>
            <UTooltip text="新建相册">
              <UButton
                icon="i-lucide-plus"
                size="sm"
                color="neutral"
                variant="ghost"
                aria-label="新建相册"
                :disabled="draftName !== null"
                @click="draftName = ''"
              />
            </UTooltip>
          </div>
          <ShellNavItem
            v-for="album in library.albumEntries"
            :key="album.id"
            :to="`/albums/${album.id}`"
            :label="album.name"
            icon="i-lucide-folder"
            :cover="album.cover"
            :count="album.count"
          />
          <form
            v-if="draftName !== null"
            @submit.prevent="commitDraft"
          >
            <UInput
              v-model="draftName"
              placeholder="相册名称"
              aria-label="新相册名称"
              icon="i-lucide-folder"
              autofocus
              class="w-full"
              @keydown.esc="draftName = null"
              @blur="commitDraft"
            />
          </form>
          <p
            v-else-if="library.loaded && !library.albums.length"
            class="px-2.5 py-1.5 text-sm text-muted"
          >
            还没有相册
          </p>
        </section>
      </nav>

      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <ShellNavItem
            to="/settings"
            label="设置"
            icon="i-lucide-settings"
          />
          <div class="flex items-center justify-between gap-2 ps-2.5">
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
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
