<script setup lang="ts">
import { createProject, deleteProject, listProjects, type ProjectSummary, SUPPORTED_IMAGE_TYPES } from '~/lib/storage/db'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()
const notify = useNotify()
const router = useRouter()
const backdrop = useBackdrop()

const projects = ref<ProjectSummary[]>([])
const thumbnails = ref<Record<string, string>>({})
const loading = ref(true)
const importing = ref(false)
const file = ref<File | null>(null)
const pendingDelete = ref<ProjectSummary | null>(null)
const uploadRef = ref<{ inputRef: HTMLInputElement | undefined } | null>(null)

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

async function refresh() {
  loading.value = true
  try {
    const list = await listProjects()
    Object.values(thumbnails.value).forEach(url => URL.revokeObjectURL(url))
    thumbnails.value = Object.fromEntries(list.map(p => [p.id, URL.createObjectURL(p.thumbnail)]))
    projects.value = list
    // 侧栏透出最近修过的那张照片
    backdrop.value = list[0]?.thumbnail ?? null
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
  <UDashboardPanel
    id="projects"
    :ui="{ root: 'bg-deep', body: 'gap-8 sm:gap-8' }"
  >
    <template #header>
      <UDashboardNavbar title="工程">
        <template #right>
          <UButton
            icon="i-lucide-image-plus"
            label="导入照片"
            :loading="importing"
            @click="uploadRef?.inputRef?.click()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <UAlert
          v-if="!settings.isVisionReady"
          color="warning"
          variant="subtle"
          icon="i-lucide-key-round"
          title="尚未配置模型接口"
          description="填写 OpenAI 兼容接口的 Base URL 和 API Key 后，即可使用 AI 读图建议与局部重绘。不配置也可以手动调色和导出。"
          :actions="[{ label: '前往设置', to: '/settings', color: 'primary', variant: 'solid', size: 'lg' }]"
        />

        <UFileUpload
          ref="uploadRef"
          v-model="file"
          :accept="SUPPORTED_IMAGE_TYPES.join(',')"
          :disabled="importing"
          icon="i-lucide-image-plus"
          label="拖入照片，或点击选择"
          description="支持 JPEG、PNG、WebP。图片只保存在本机浏览器中，仅在使用 AI 功能时发送给你配置的接口。"
          class="w-full"
          :class="projects.length ? 'min-h-36' : 'min-h-56'"
          :ui="{
            base: 'rounded-xl border-dashed border-accented bg-transparent duration-200 hover:bg-elevated data-[dragging=true]:bg-(--mac-selected)',
            icon: 'text-muted',
            label: 'text-highlighted',
            description: 'max-w-xl text-balance text-muted'
          }"
        />

        <section
          aria-labelledby="recent-heading"
          class="flex flex-col gap-4"
        >
          <h2
            id="recent-heading"
            class="section-title"
          >
            最近的工程
          </h2>
          <div
            v-if="loading"
            class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            <div
              v-for="i in 4"
              :key="i"
              class="aspect-4/3 rounded-xl border border-default bg-default"
            />
          </div>
          <UEmpty
            v-else-if="projects.length === 0"
            icon="i-lucide-images"
            title="还没有工程"
            description="导入一张照片开始修图"
          />
          <ul
            v-else
            class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            <li
              v-for="project in projects"
              :key="project.id"
              class="overflow-hidden rounded-xl border border-default bg-default transition-colors duration-200 ease-out hover:border-accented hover:bg-(--mac-mid-hover)"
            >
              <NuxtLink
                :to="`/editor/${project.id}`"
                class="block outline-primary/60 focus-visible:outline-2 focus-visible:-outline-offset-2"
                tabindex="-1"
                aria-hidden="true"
              >
                <img
                  :src="thumbnails[project.id]"
                  alt=""
                  class="aspect-4/3 w-full border-b border-default bg-deep object-cover"
                >
              </NuxtLink>
              <div class="flex items-center justify-between gap-2 py-2 ps-3 pe-1.5">
                <NuxtLink
                  :to="`/editor/${project.id}`"
                  class="min-w-0 rounded-md outline-primary/60 focus-visible:outline-2"
                >
                  <p class="truncate text-sm font-medium text-highlighted">{{ project.name }}</p>
                  <p class="truncate text-xs text-muted tabular-nums">
                    {{ project.width }}×{{ project.height }} · {{ dateFormat.format(project.updatedAt) }}
                  </p>
                </NuxtLink>
                <UButton
                  icon="i-lucide-trash-2"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  aria-label="删除工程"
                  @click="pendingDelete = project"
                />
              </div>
            </li>
          </ul>
        </section>
      </div>
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
    </template>
  </UDashboardPanel>
</template>
