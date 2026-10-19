<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { useLibraryStore } from '~/stores/library'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const notify = useNotify()

const albumId = computed(() => String(route.params.id))
const album = computed(() => library.findAlbum(albumId.value))
const count = computed(() => library.projectsIn(albumId.value).length)

/** 正在编辑的相册名称；null 表示没有在重命名 */
const draftName = ref<string | null>(null)
const renameInput = ref<{ inputRef: HTMLInputElement | undefined } | null>(null)
const confirmingDelete = ref(false)
const pickingEmoji = ref(false)
/** 更换图标弹窗里还没确认的选择 */
const draftEmoji = ref<string | null>(null)

/**
 * 菜单关闭时默认把焦点还给菜单按钮。选了「重命名相册」时改为交给标题栏的输入框，
 * 否则输入框刚出现就失焦，失焦即提交，输入框随之收起
 */
function onMenuCloseAutoFocus(event: Event) {
  if (draftName.value !== null) {
    event.preventDefault()
    renameInput.value?.inputRef?.focus()
  }
}

const menuItems: DropdownMenuItem[][] = [
  [{
    label: '重命名相册',
    icon: 'i-lucide-pencil',
    onSelect: () => {
      draftName.value = album.value?.name ?? ''
    }
  }, {
    label: '更换图标',
    icon: 'i-lucide-smile',
    onSelect: () => {
      draftEmoji.value = album.value?.emoji ?? null
      pickingEmoji.value = true
    }
  }],
  [{
    label: '删除相册',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => {
      confirmingDelete.value = true
    }
  }]
]

// 换到另一个相册时放弃未提交的重命名与图标
watch(albumId, () => {
  draftName.value = null
  confirmingDelete.value = false
  pickingEmoji.value = false
})

/** 回车与失焦都会提交：先清空草稿，输入框卸载时再触发的失焦就不会重复写入 */
async function commitRename() {
  const name = draftName.value
  draftName.value = null
  if (name === null) {
    return
  }
  try {
    await library.renameAlbum(albumId.value, name)
  } catch (err) {
    notify.error(err)
  }
}

async function commitEmoji() {
  pickingEmoji.value = false
  try {
    await library.setAlbumEmoji(albumId.value, draftEmoji.value)
  } catch (err) {
    notify.error(err)
  }
}

/** 先回到图库再删除：反过来的话，本页会在跳转前闪一下「相册不存在」 */
async function confirmDeleteAlbum() {
  const id = albumId.value
  confirmingDelete.value = false
  await router.push('/')
  try {
    await library.removeAlbum(id)
  } catch (err) {
    notify.error(err)
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
      v-if="draftName !== null"
      #title
    >
      <form
        class="w-full max-w-sm"
        @submit.prevent="commitRename"
      >
        <UInput
          ref="renameInput"
          v-model="draftName"
          aria-label="相册名称"
          class="w-full"
          @keydown.esc="draftName = null"
          @blur="commitRename"
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
      <UModal
        v-model:open="pickingEmoji"
        title="更换图标"
        description="选「照片封面」时，侧栏显示相册里最近修改的那张照片"
      >
        <template #body>
          <LibraryEmojiPicker v-model="draftEmoji" />
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="取消"
              @click="pickingEmoji = false"
            />
            <UButton
              label="完成"
              @click="commitEmoji"
            />
          </div>
        </template>
      </UModal>
      <UModal
        v-model:open="confirmingDelete"
        title="删除相册"
        :description="`确定删除相册「${album?.name ?? ''}」吗？其中的 ${count} 个工程不会被删除，仍在图库里。`"
      >
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="取消"
              @click="confirmingDelete = false"
            />
            <UButton
              color="error"
              label="删除相册"
              @click="confirmDeleteAlbum"
            />
          </div>
        </template>
      </UModal>
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
