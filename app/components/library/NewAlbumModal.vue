<script setup lang="ts">
import { useLibraryStore } from '~/stores/library'

/** 新建相册：名称与图标（emoji 或照片封面），创建后进入该相册。每次打开都从空白开始 */
const open = defineModel<boolean>('open', { required: true })
const library = useLibraryStore()
const notify = useNotify()
const router = useRouter()

const name = ref('')
const emoji = ref<string | null>(null)
const creating = ref(false)

watch(open, (value) => {
  if (value) {
    name.value = ''
    emoji.value = null
  }
})

async function create() {
  if (!name.value.trim() || creating.value) {
    return
  }
  creating.value = true
  try {
    const album = await library.addAlbum(name.value, emoji.value)
    open.value = false
    if (album) {
      await router.push(`/albums/${album.id}`)
    }
  } catch (err) {
    notify.error(err)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="新建相册"
    :dismissible="!creating"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="名称">
          <UInput
            v-model="name"
            placeholder="相册名称"
            autofocus
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="图标"
          help="选「照片封面」时，侧栏显示相册里最近修改的那张照片"
        >
          <LibraryEmojiPicker v-model="emoji" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <DialogActions
        confirm-label="新建相册"
        :disabled="!name.trim()"
        :loading="creating"
        @confirm="create"
        @cancel="open = false"
      />
    </template>
  </UModal>
</template>
