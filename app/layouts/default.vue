<script setup lang="ts">
import { useLibraryStore } from '~/stores/library'

/**
 * 图库、相册与设置共用的窗口外壳：毛玻璃导航侧栏 + 内容区；侧栏背后的照片底图由 app.vue 常驻渲染。
 * 侧栏按 macOS「照片」的结构排列：图库在上，相册分组其次，设置与外观收在底部。
 * 工程与相册数据在这里读取一次，侧栏和各页面共用；从编辑器返回时外壳重新挂载，列表随之刷新。
 * 「图库」与各相册那一行也是工程卡片的放下目标：拖到相册上移进去，拖到「图库」上移出所在相册。
 * 首次启动的配置向导也挂在外壳里，浮在启动时所在的页面（通常是图库）之上。
 */
const colorMode = useColorMode()
const library = useLibraryStore()
const notify = useNotify()
const backdrop = useBackdrop()

const appearanceItems = [
  { value: 'system', label: '跟随系统', icon: 'i-lucide-monitor' },
  { value: 'light', label: '浅色', icon: 'i-lucide-sun' },
  { value: 'dark', label: '深色', icon: 'i-lucide-moon' }
]

const creatingAlbum = ref(false)
const albumActions = useAlbumActions()
const { renaming } = albumActions
const drag = useProjectDrag()

/**
 * 右键菜单关闭时焦点默认回到右键前的位置。选了「重命名相册」时那一行已换成输入框并自动聚焦，
 * 不能再把焦点拿走，否则输入框刚出现就失焦，失焦即提交
 */
function onAlbumMenuCloseAutoFocus(event: Event) {
  if (renaming.value?.place === 'sidebar') {
    event.preventDefault()
  }
}

onMounted(async () => {
  try {
    await library.refresh()
    // 图库页与相册页各自决定透出哪张照片；直接打开设置页时还没有底图，用最近修过的那张，侧栏不会是一片纯灰
    backdrop.value ??= library.projects[0]?.thumbnail ?? null
  } catch (err) {
    notify.error(err)
  }
})
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
          <!-- 与安装包、启动画面同一个应用图标源文件 -->
          <img
            src="/app-icon.svg"
            alt=""
            draggable="false"
            class="size-6 shrink-0"
          >
          <!-- 思源黑体的上伸部比下伸部大，行框居中时字形偏低；文字盒裁到大写字母顶端与基线之间，字形中心才与图标对齐 -->
          <span class="text-[17px] font-semibold text-highlighted [text-box:trim-both_cap_alphabetic]">AI修图大师</span>
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
          :dropping="drag.isDropping(null)"
          v-bind="drag.dropTarget(null)"
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
                @click="creatingAlbum = true"
              />
            </UTooltip>
          </div>
          <template
            v-for="album in library.albumEntries"
            :key="album.id"
          >
            <!-- 与 macOS「照片」一样，从侧栏右键重命名时就在这一行里改名 -->
            <form
              v-if="albumActions.isRenaming(album.id, 'sidebar') && renaming"
              @submit.prevent="albumActions.commitRename"
            >
              <UInput
                v-model="renaming.name"
                aria-label="相册名称"
                autofocus
                class="w-full"
                @keydown.esc="renaming = null"
                @blur="albumActions.commitRename"
              />
            </form>
            <UContextMenu
              v-else
              :items="albumActions.menu(album.id, 'sidebar')"
              :content="{ onCloseAutoFocus: onAlbumMenuCloseAutoFocus }"
            >
              <ShellNavItem
                :to="`/albums/${album.id}`"
                :label="album.name"
                icon="i-lucide-folder"
                :emoji="album.emoji"
                :cover="album.cover"
                :count="album.count"
                :dropping="drag.isDropping(album.id)"
                v-bind="drag.dropTarget(album.id)"
              />
            </UContextMenu>
          </template>
          <p
            v-if="library.loaded && !library.albums.length"
            class="px-2.5 py-1.5 text-sm text-muted"
          >
            还没有相册
          </p>
        </section>
      </nav>

      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <ShellDownloadItem />
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

    <LibraryNewAlbumModal v-model:open="creatingAlbum" />
    <LibraryAlbumDialogs />
    <SettingsSetupWizard />

    <slot />
  </UDashboardGroup>
</template>
