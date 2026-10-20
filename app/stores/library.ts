import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { type DropSide, isSortMode, isViewMode, planReorder, type SortMode, sortProjects, type ViewMode } from '~/lib/library/order'
import {
  createAlbum,
  deleteAlbum,
  deleteProject,
  listAlbums,
  listProjects,
  moveProjectToAlbum,
  type ProjectSummary,
  renameAlbum as renameAlbumRecord,
  setAlbumEmoji as setAlbumEmojiRecord,
  setProjectOrders
} from '~/lib/storage/db'
import type { AlbumRecord } from '~/lib/types'

/** 侧栏里的一个相册：数量与封面（相册里最近修改的那个工程的缩略图）由工程列表推导 */
export interface AlbumEntry extends AlbumRecord {
  count: number
  cover: string | null
}

/** 删除的工程在列表里淡出期间仍显示缩略图，等过渡结束再释放地址 */
const RELEASE_DELAY = 1000

const SORT_STORAGE_KEY = 'apm-library-sort'
const VIEW_STORAGE_KEY = 'apm-library-view'

/** 读取记在本机的选项；没有存档、存档无效或 localStorage 不可读时用默认值 */
function loadChoice<T extends string>(key: string, isValid: (value: unknown) => value is T, fallback: T): T {
  try {
    const saved = globalThis.localStorage?.getItem(key)
    return isValid(saved) ? saved : fallback
  } catch {
    return fallback
  }
}

function saveChoice(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 隐私模式等场景下 localStorage 不可写，选项仅在本次会话内生效
  }
}

/** 移动之后工程不再占着原来的手动位置（见 moveProjectToAlbum），列表里同步去掉 order */
function withAlbum(project: ProjectSummary, albumId: string | null): ProjectSummary {
  const next = { ...project }
  delete next.order
  if (albumId) {
    next.albumId = albumId
  } else {
    delete next.albumId
  }
  return next
}

/**
 * 图库：全部工程与相册。侧栏、图库页、相册页和编辑器的返回入口共用这一份数据。
 * 整理操作（删除工程、移动、排序、相册增删改）写库后就地更新列表，不整表重读，卡片可以原地让位。
 * projects 始终按最近修改倒序（封面与侧栏底图都取最近修改的那张），页面上看到的排序由 sortedProjectsIn 给出。
 * 缩略图建档后不再改变，地址按工程 id 缓存，刷新时只为新出现的工程创建。
 */
export const useLibraryStore = defineStore('library', () => {
  const projects = ref<ProjectSummary[]>([])
  const albums = ref<AlbumRecord[]>([])
  const thumbnails = ref<Record<string, string>>({})
  /** 首次读取完成前，页面显示骨架而不是「没有工程」 */
  const loaded = ref(false)
  /** 图库页与相册页共用的排序方式，记在本机 */
  const sortMode = ref<SortMode>(loadChoice(SORT_STORAGE_KEY, isSortMode, 'recent'))
  /** 图库页的展示方式（全部 / 按相册），相册页不受影响，记在本机 */
  const viewMode = ref<ViewMode>(loadChoice(VIEW_STORAGE_KEY, isViewMode, 'all'))

  watch(sortMode, mode => saveChoice(SORT_STORAGE_KEY, mode))
  watch(viewMode, mode => saveChoice(VIEW_STORAGE_KEY, mode))

  async function refresh(): Promise<void> {
    const [projectList, albumList] = await Promise.all([listProjects(), listAlbums()])
    const next: Record<string, string> = {}
    for (const project of projectList) {
      next[project.id] = thumbnails.value[project.id] ?? URL.createObjectURL(project.thumbnail)
    }
    for (const [id, url] of Object.entries(thumbnails.value)) {
      if (!(id in next)) {
        URL.revokeObjectURL(url)
      }
    }
    thumbnails.value = next
    projects.value = projectList
    albums.value = albumList
    loaded.value = true
  }

  const albumEntries = computed<AlbumEntry[]>(() => {
    // 工程列表按修改时间倒序，每个相册遇到的第一个工程就是封面
    const stats = new Map<string, { count: number, cover: string | null }>()
    for (const project of projects.value) {
      if (!project.albumId) {
        continue
      }
      const entry = stats.get(project.albumId)
      if (entry) {
        entry.count++
      } else {
        stats.set(project.albumId, { count: 1, cover: thumbnails.value[project.id] ?? null })
      }
    }
    return albums.value.map(album => ({ ...album, count: stats.get(album.id)?.count ?? 0, cover: stats.get(album.id)?.cover ?? null }))
  })

  /** albumId 为 null 时是整个图库 */
  function projectsIn(albumId: string | null): ProjectSummary[] {
    return albumId ? projects.value.filter(project => project.albumId === albumId) : projects.value
  }

  /** 页面上看到的顺序：projectsIn 按当前排序方式重排 */
  function sortedProjectsIn(albumId: string | null): ProjectSummary[] {
    return sortProjects(projectsIn(albumId), sortMode.value)
  }

  function findAlbum(id: string): AlbumRecord | undefined {
    return albums.value.find(album => album.id === id)
  }

  async function removeProject(id: string): Promise<void> {
    await deleteProject(id)
    projects.value = projects.value.filter(project => project.id !== id)
    const url = thumbnails.value[id]
    if (url) {
      setTimeout(() => {
        URL.revokeObjectURL(url)
        if (thumbnails.value[id] === url) {
          thumbnails.value = Object.fromEntries(Object.entries(thumbnails.value).filter(([key]) => key !== id))
        }
      }, RELEASE_DELAY)
    }
  }

  async function moveProject(projectId: string, albumId: string | null): Promise<void> {
    await moveProjectToAlbum(projectId, albumId)
    projects.value = projects.value.map(project => project.id === projectId ? withAlbum(project, albumId) : project)
  }

  /**
   * 把工程放到同一个网格里另一个工程的前面或后面。shown 是这个网格此刻看到的工程 id，按显示顺序
   * （整个图库、一个相册，或按相册分组时的一组）。无论原来是哪种排序方式，看到的顺序就成了手动顺序，
   * 排序方式随之切到「手动排序」；放回原位时什么都不做
   */
  async function reorderProject(projectId: string, targetId: string, side: DropSide, shown: readonly string[]): Promise<void> {
    const plan = planReorder(projects.value, shown, projectId, targetId, side)
    if (!plan.size) {
      return
    }
    await setProjectOrders(plan)
    projects.value = projects.value.map(project => plan.has(project.id) ? { ...project, order: plan.get(project.id)! } : project)
    sortMode.value = 'manual'
  }

  /** 名称去掉首尾空白；为空时不创建，返回 null。emoji 为 null 时侧栏显示封面 */
  async function addAlbum(name: string, emoji: string | null = null): Promise<AlbumRecord | null> {
    const trimmed = name.trim()
    if (!trimmed) {
      return null
    }
    const album = await createAlbum(trimmed, emoji ?? undefined)
    albums.value = [...albums.value, album]
    return album
  }

  /** 名称为空或未改变时保留原名 */
  async function renameAlbum(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || findAlbum(id)?.name === trimmed) {
      return
    }
    await renameAlbumRecord(id, trimmed)
    albums.value = albums.value.map(album => album.id === id ? { ...album, name: trimmed } : album)
  }

  /** emoji 未改变时不写库；为 null 时去掉 emoji，侧栏改回显示封面 */
  async function setAlbumEmoji(id: string, emoji: string | null): Promise<void> {
    if ((findAlbum(id)?.emoji ?? null) === emoji) {
      return
    }
    await setAlbumEmojiRecord(id, emoji)
    albums.value = albums.value.map((album) => {
      if (album.id !== id) {
        return album
      }
      const next = { ...album }
      if (emoji) {
        next.emoji = emoji
      } else {
        delete next.emoji
      }
      return next
    })
  }

  async function removeAlbum(id: string): Promise<void> {
    await deleteAlbum(id)
    albums.value = albums.value.filter(album => album.id !== id)
    projects.value = projects.value.map(project => project.albumId === id ? withAlbum(project, null) : project)
  }

  return {
    projects,
    albums,
    thumbnails,
    loaded,
    sortMode,
    viewMode,
    albumEntries,
    refresh,
    projectsIn,
    sortedProjectsIn,
    findAlbum,
    removeProject,
    moveProject,
    reorderProject,
    addAlbum,
    renameAlbum,
    setAlbumEmoji,
    removeAlbum
  }
})
