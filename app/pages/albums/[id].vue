<script setup lang="ts">
import { useLibraryStore } from '~/stores/library'

const route = useRoute()
const library = useLibraryStore()
const albumActions = useAlbumActions()
const { renaming } = albumActions

const albumId = computed(() => String(route.params.id))
const album = computed(() => library.findAlbum(albumId.value))
/** 菜单与侧栏右键菜单相同；在这里选「重命名相册」时在标题栏就地改名 */
const menuItems = computed(() => albumActions.menu(albumId.value, 'title'))
const renamingTitle = computed(() => albumActions.isRenaming(albumId.value, 'title'))

const renameInput = ref<{ inputRef: HTMLInputElement | undefined } | null>(null)

/**
 * 菜单关闭时默认把焦点还给菜单按钮。选了「重命名相册」时改为交给标题栏的输入框，
 * 否则输入框刚出现就失焦，失焦即提交，输入框随之收起
 */
function onMenuCloseAutoFocus(event: Event) {
  if (renamingTitle.value) {
    event.preventDefault()
    renameInput.value?.inputRef?.focus()
  }
}
</script>

<template>
  <LibraryPanel
    v-if="album || !library.loaded"
    id="album"
    :title="album?.name ?? ''"
    :album-id="albumId"
  >
    <template
      v-if="renamingTitle && renaming"
      #title
    >
      <form
        class="w-full max-w-sm"
        @submit.prevent="albumActions.commitRename"
      >
        <UInput
          ref="renameInput"
          v-model="renaming.name"
          aria-label="相册名称"
          class="w-full"
          @keydown.esc="renaming = null"
          @blur="albumActions.commitRename"
        />
      </form>
    </template>
    <template #actions>
      <UDropdownMenu
        :items="menuItems"
        :content="{ align: 'end', onCloseAutoFocus: onMenuCloseAutoFocus }"
        :disabled="!album"
      >
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="ghost"
          aria-label="相册操作"
        />
      </UDropdownMenu>
    </template>
  </LibraryPanel>

  <UDashboardPanel
    v-else
    id="album"
    :ui="{ root: 'bg-deep' }"
  >
    <template #header>
      <UDashboardNavbar title="相册" />
    </template>
    <template #body>
      <UEmpty
        icon="i-lucide-folder-x"
        title="相册不存在"
        description="它可能已经被删除，其中的工程仍在图库里。"
        :actions="[{ label: '返回图库', to: '/', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'outline', size: 'lg' }]"
        class="my-auto"
      />
    </template>
  </UDashboardPanel>
</template>
