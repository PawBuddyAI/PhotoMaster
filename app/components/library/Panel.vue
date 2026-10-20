<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { pinLeaving } from '~/lib/motion'
import { createProject, type ProjectSummary, SUPPORTED_IMAGE_TYPES } from '~/lib/storage/db'
import { useLibraryStore } from '~/stores/library'
import { useSettingsStore } from '~/stores/settings'

/**
 * 工程网格：图库页列出全部工程，相册页只列出该相册的工程；在相册页导入的照片直接放进这个相册。
 * 页面自定义标题区（相册重命名）和标题栏右侧的额外操作（相册菜单），导入、移动和删除工程在这里统一处理。
 */
const props = defineProps<{
  id: string
  title: string
  /** 不传时是整个图库 */
  albumId?: string
}>()

defineSlots<{
  title?: () => unknown
  actions?: () => unknown
}>()

const settings = useSettingsStore()
const library = useLibraryStore()
const notify = useNotify()
const router = useRouter()
const backdrop = useBackdrop()

/** 已解码完成的缩略图：解码前只露出凹槽底色，完成后再淡入，网格不会逐张闪现 */
const decoded = ref(new Set<string>())
const importing = ref(false)
const file = ref<File | null>(null)
const pendingDelete = ref<ProjectSummary | null>(null)
const uploadRef = ref<{ inputRef: HTMLInputElement | undefined } | null>(null)

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

const projects = computed(() => library.projectsIn(props.albumId ?? null))

// 侧栏透出这里最近修过的那张照片；空相册沿用图库最近的照片，侧栏不会突然褪成纯灰
watchEffect(() => {
  if (library.loaded) {
    backdrop.value = (projects.value[0] ?? library.projects[0])?.thumbnail ?? null
  }
})

watch(file, async (selected) => {
  if (!selected) {
    return
  }
  importing.value = true
  try {
    const id = await createProject(selected, props.albumId)
    await router.push(`/editor/${id}`)
  } catch (err) {
    notify.error(err)
  } finally {
    importing.value = false
    file.value = null
  }
})

async function move(project: ProjectSummary, albumId: string | null) {
  try {
    await library.moveProject(project.id, albumId)
    const target = albumId ? library.findAlbum(albumId) : null
    notify.success(target ? `已移到相册「${target.name}」` : '已移出相册', project.name)
  } catch (err) {
    notify.error(err)
  }
}

function cardMenu(project: ProjectSummary): DropdownMenuItem[][] {
  const targets = library.albums.filter(album => album.id !== project.albumId)
  const organize: DropdownMenuItem[] = [{
    label: '移到相册',
    icon: 'i-lucide-folder-input',
    children: targets.length
      // 有 emoji 的相册走 album 插槽，用 emoji 代替文件夹图标
      ? targets.map(album => ({ label: album.name, icon: 'i-lucide-folder', emoji: album.emoji, slot: album.emoji ? 'album' : undefined, onSelect: () => move(project, album.id) }))
      : [{ label: library.albums.length ? '没有其他相册' : '还没有相册，可在侧栏新建', disabled: true }]
  }]
  if (project.albumId) {
    organize.push({ label: '移出相册', icon: 'i-lucide-folder-output', onSelect: () => move(project, null) })
  }
  const remove: DropdownMenuItem = {
    label: '删除工程',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => {
      pendingDelete.value = project
    }
  }
  return [organize, [remove]]
}

async function confirmDelete() {
  const target = pendingDelete.value
  if (!target) {
    return
  }
  try {
    // 只从列表中移除这一项：卡片原地淡出、其余卡片让位，不整表刷新
    await library.removeProject(target.id)
    pendingDelete.value = null
  } catch (err) {
    notify.error(err)
  }
}
</script>

<template>
  <UDashboardPanel
    :id="id"
    :ui="{ root: 'bg-deep', body: 'gap-8 sm:gap-8' }"
  >
    <template #header>
      <UDashboardNavbar :title="title">
        <template
          v-if="$slots.title"
          #title
        >
          <slot name="title" />
        </template>
        <template #right>
          <slot name="actions" />
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
          description="支持 JPEG、PNG、WebP。图片只保存在本机，仅在使用 AI 功能时发送给你配置的接口。"
          class="w-full"
          :class="projects.length ? 'min-h-36' : 'min-h-56'"
          :ui="{
            base: 'rounded-xl border-dashed border-accented bg-transparent duration-200 hover:bg-elevated data-[dragging=true]:bg-(--mac-selected)',
            icon: 'text-muted',
            label: 'text-highlighted',
            description: 'max-w-xl text-balance text-muted'
          }"
        />

        <!-- 图库为空时拖放区就是唯一的入口，不再重复一个「还没有工程」；空相册说明怎样把已有工程放进来（在相册里导入的照片会直接放进相册） -->
        <section
          v-if="!library.loaded || projects.length || albumId"
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
            v-if="!library.loaded"
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
            icon="i-lucide-folder-open"
            title="相册里还没有工程"
            description="在图库里打开工程卡片的「更多操作」，可以把已有的工程移到这个相册。"
          />
          <TransitionGroup
            v-else
            tag="ul"
            name="list"
            class="relative grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
            @before-leave="pinLeaving"
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
                  :src="library.thumbnails[project.id]"
                  alt=""
                  class="aspect-4/3 w-full border-b border-default bg-deep object-cover transition-opacity duration-300 ease-out"
                  :class="decoded.has(project.id) ? 'opacity-100' : 'opacity-0'"
                  @load="decoded.add(project.id)"
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
                <UDropdownMenu
                  :items="cardMenu(project)"
                  :content="{ align: 'end' }"
                >
                  <!-- 菜单项是运行时拼出来的，slot 名不是字面量，Nuxt UI 推断不出插槽参数的类型 -->
                  <template #album-leading="{ item }">
                    <span
                      aria-hidden="true"
                      class="flex size-4 shrink-0 items-center justify-center text-sm leading-none"
                    >{{ (item as DropdownMenuItem).emoji }}</span>
                  </template>
                  <UButton
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="更多操作"
                  />
                </UDropdownMenu>
              </div>
            </li>
          </TransitionGroup>
        </section>
      </div>
      <UModal
        :open="!!pendingDelete"
        title="删除工程"
        :description="`确定删除「${pendingDelete?.name ?? ''}」吗？原图与所有修改都会从本机删除，无法恢复。`"
        @update:open="value => { if (!value) pendingDelete = null }"
      >
        <template #footer>
          <DialogActions
            confirm-label="删除"
            danger
            @confirm="confirmDelete"
            @cancel="pendingDelete = null"
          />
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
