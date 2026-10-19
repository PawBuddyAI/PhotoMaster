import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createAlbum,
  deleteAlbum,
  deleteProject,
  listAlbums,
  listProjects,
  moveProjectToAlbum,
  type ProjectSummary,
  renameAlbum as renameAlbumRecord
} from '~/lib/storage/db'
import type { AlbumRecord } from '~/lib/types'

/** 侧栏里的一个相册：数量与封面（相册里最近修改的那个工程的缩略图）由工程列表推导 */
export interface AlbumEntry extends AlbumRecord {
  count: number
  cover: string | null
}

/** 删除的工程在列表里淡出期间仍显示缩略图，等过渡结束再释放地址 */
const RELEASE_DELAY = 1000

function withAlbum(project: ProjectSummary, albumId: string | null): ProjectSummary {
  const next = { ...project }
  if (albumId) {
    next.albumId = albumId
  } else {
    delete next.albumId
  }
  return next
}

/**
 * 图库：全部工程与相册。侧栏、图库页、相册页和编辑器的返回入口共用这一份数据。
 * 整理操作（删除工程、移动、相册增删改）写库后就地更新列表，不整表重读，卡片可以原地让位。
 * 缩略图建档后不再改变，地址按工程 id 缓存，刷新时只为新出现的工程创建。
 */
export const useLibraryStore = defineStore('library', () => {
  const projects = ref<ProjectSummary[]>([])
  const albums = ref<AlbumRecord[]>([])
  const thumbnails = ref<Record<string, string>>({})
  /** 首次读取完成前，页面显示骨架而不是「没有工程」 */
  const loaded = ref(false)

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

  /** 名称去掉首尾空白；为空时不创建，返回 null */
  async function addAlbum(name: string): Promise<AlbumRecord | null> {
    const trimmed = name.trim()
    if (!trimmed) {
      return null
    }
    const album = await createAlbum(trimmed)
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
    albumEntries,
    refresh,
    projectsIn,
    findAlbum,
    removeProject,
    moveProject,
    addAlbum,
    renameAlbum,
    removeAlbum
  }
})
