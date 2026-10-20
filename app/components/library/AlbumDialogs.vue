<script setup lang="ts">
import type { AlbumRecord } from '~/lib/types'
import { useLibraryStore } from '~/stores/library'

/**
 * 相册的更换图标与删除确认弹窗，外壳里只渲染一份：侧栏的右键菜单和相册页的「相册操作」都经 useAlbumActions 打开。
 * 打开时记下相册与工程数，弹窗淡出期间文字不会先变空
 */
const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const notify = useNotify()
const { pickingEmoji, deleting } = useAlbumActions()

/** 更换图标弹窗里还没确认的选择 */
const draftEmoji = ref<string | null>(null)
const target = ref<{ album: AlbumRecord, count: number } | null>(null)

watch(pickingEmoji, (id) => {
  if (id) {
    draftEmoji.value = library.findAlbum(id)?.emoji ?? null
  }
})

watch(deleting, (id) => {
  const album = id ? library.findAlbum(id) : undefined
  if (album) {
    target.value = { album, count: library.projectsIn(album.id).length }
  }
})

async function commitEmoji() {
  const id = pickingEmoji.value
  pickingEmoji.value = null
  if (!id) {
    return
  }
  try {
    await library.setAlbumEmoji(id, draftEmoji.value)
  } catch (err) {
    notify.error(err)
  }
}

/** 正在看这个相册时先回到图库再删除：反过来的话，相册页会在跳转前闪一下「相册不存在」 */
async function confirmDelete() {
  const id = deleting.value
  deleting.value = null
  if (!id) {
    return
  }
  if (route.name === 'albums-id' && String(route.params.id) === id) {
    await router.push('/')
  }
  try {
    await library.removeAlbum(id)
  } catch (err) {
    notify.error(err)
  }
}
</script>

<template>
  <UModal
    :open="pickingEmoji !== null"
    title="更换图标"
    description="选「照片封面」时，侧栏显示相册里最近修改的那张照片"
    @update:open="value => { if (!value) pickingEmoji = null }"
  >
    <template #body>
      <LibraryEmojiPicker v-model="draftEmoji" />
    </template>
    <template #footer>
      <DialogActions
        confirm-label="完成"
        @confirm="commitEmoji"
        @cancel="pickingEmoji = null"
      />
    </template>
  </UModal>
  <UModal
    :open="deleting !== null"
    title="删除相册"
    :description="`确定删除相册「${target?.album.name ?? ''}」吗？其中的 ${target?.count ?? 0} 个工程不会被删除，仍在图库里。`"
    @update:open="value => { if (!value) deleting = null }"
  >
    <template #footer>
      <DialogActions
        confirm-label="删除相册"
        danger
        @confirm="confirmDelete"
        @cancel="deleting = null"
      />
    </template>
  </UModal>
</template>
