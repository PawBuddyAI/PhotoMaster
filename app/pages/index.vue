<script setup lang="ts">
import { createProject, deleteProject, listProjects, type ProjectSummary, SUPPORTED_IMAGE_TYPES } from '~/lib/storage/db'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()
const notify = useNotify()
const router = useRouter()

const projects = ref<ProjectSummary[]>([])
const thumbnails = ref<Record<string, string>>({})
const loading = ref(true)
const importing = ref(false)
const file = ref<File | null>(null)
const pendingDelete = ref<ProjectSummary | null>(null)

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

async function refresh() {
  loading.value = true
  try {
    const list = await listProjects()
    Object.values(thumbnails.value).forEach(url => URL.revokeObjectURL(url))
    thumbnails.value = Object.fromEntries(list.map(p => [p.id, URL.createObjectURL(p.thumbnail)]))
    projects.value = list
  } catch (err) {
    notify.error(err)
  } finally {
    loading.value = false
  }
}

watch(file, async (selected) => {
  if (!selected) {
    return
  }
  importing.value = true
  try {
    const id = await createProject(selected)
    await router.push(`/editor/${id}`)
  } catch (err) {
    notify.error(err)
  } finally {
    importing.value = false
    file.value = null
  }
})

async function confirmDelete() {
  const target = pendingDelete.value
  if (!target) {
    return
  }
  try {
    await deleteProject(target.id)
    pendingDelete.value = null
    await refresh()
  } catch (err) {
    notify.error(err)
  }
}

onMounted(refresh)
onBeforeUnmount(() => Object.values(thumbnails.value).forEach(url => URL.revokeObjectURL(url)))
</script>

<template>
  <div class="min-h-screen bg-default">
    <header class="border-b border-default">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-aperture"
            class="size-6 text-primary"
          />
          <span class="text-lg font-semibold">AI 修图</span>
        </div>
        <div class="flex items-center gap-1">
          <UColorModeButton />
          <UButton
            to="/settings"
            icon="i-lucide-settings"
            color="neutral"
            variant="ghost"
            label="设置"
          />
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <UAlert
        v-if="!settings.isVisionReady"
        color="warning"
        variant="subtle"
        icon="i-lucide-key-round"
        title="尚未配置模型接口"
        description="填写 OpenAI 兼容接口的 Base URL 和 API Key 后，即可使用 AI 读图建议与局部重绘。不配置也可以手动调色和导出。"
        :actions="[{ label: '前往设置', to: '/settings', color: 'warning', variant: 'solid', size: 'lg' }]"
      />

      <UFileUpload
        v-model="file"
        :accept="SUPPORTED_IMAGE_TYPES.join(',')"
        :disabled="importing"
        icon="i-lucide-image-plus"
        label="拖入照片，或点击选择"
        description="支持 JPEG、PNG、WebP。图片只保存在本机浏览器中，仅在使用 AI 功能时发送给你配置的接口。"
        class="min-h-52 w-full"
      />

      <section class="space-y-4">
        <h2 class="text-base font-semibold">
          最近的工程
        </h2>
        <div
          v-if="loading"
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        >
          <USkeleton
            v-for="i in 4"
            :key="i"
            class="aspect-4/3 rounded-lg"
          />
        </div>
        <UEmpty
          v-else-if="projects.length === 0"
          icon="i-lucide-images"
          title="还没有工程"
          description="导入一张照片开始修图"
        />
        <div
          v-else
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        >
          <div
            v-for="project in projects"
            :key="project.id"
            class="group overflow-hidden rounded-lg border border-default bg-elevated/40 transition hover:border-primary/60"
          >
            <NuxtLink
              :to="`/editor/${project.id}`"
              class="block"
            >
              <img
                :src="thumbnails[project.id]"
                :alt="project.name"
                class="aspect-4/3 w-full bg-muted object-cover"
              >
            </NuxtLink>
            <div class="flex items-start justify-between gap-2 p-3">
              <NuxtLink
                :to="`/editor/${project.id}`"
                class="min-w-0"
              >
                <p class="truncate text-sm font-medium">{{ project.name }}</p>
                <p class="text-xs text-muted">
                  {{ project.width }}×{{ project.height }} · {{ dateFormat.format(project.updatedAt) }}
                </p>
              </NuxtLink>
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="删除工程"
                @click="pendingDelete = project"
              />
            </div>
          </div>
        </div>
      </section>
    </main>

    <UModal
      :open="!!pendingDelete"
      title="删除工程"
      :description="`确定删除「${pendingDelete?.name ?? ''}」吗？原图与所有修改都会从本机删除，无法恢复。`"
      @update:open="value => { if (!value) pendingDelete = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="取消"
            @click="pendingDelete = null"
          />
          <UButton
            color="error"
            label="删除"
            @click="confirmDelete"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
