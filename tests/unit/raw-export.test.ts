import { beforeEach, expect, it, vi } from 'vitest'
import { useExport } from '~/composables/useExport'

const state = vi.hoisted(() => ({
  project: { name: 'photo', originalType: 'image/png', filePath: undefined as string | undefined },
  pickSavePath: vi.fn(),
  writeBlob: vi.fn()
}))
vi.mock('~/lib/desktop', () => ({ isDesktop: () => true, pickSavePath: state.pickSavePath, writeBlob: state.writeBlob }))
vi.mock('~/stores/editor', () => ({ useEditorStore: () => ({ project: state.project }) }))
vi.mock('~/composables/useImageWorker', () => ({ useImageWorker: vi.fn() }))
vi.mock('~/composables/useProjectAssets', () => ({ useProjectAssets: vi.fn() }))
vi.mock('~/lib/storage/db', () => ({ getBlob: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  state.project.filePath = undefined
})

it('RAW 工程首次保存选择新位置，取消后不写文件', async () => {
  state.pickSavePath.mockResolvedValue(null)
  expect(await useExport().save()).toBeNull()
  expect(state.pickSavePath).toHaveBeenCalledWith('photo.png', { name: 'PNG 图像', extensions: ['png'] })
  expect(state.writeBlob).not.toHaveBeenCalled()
})

it('旧记录误带 RAW 保存路径时也不覆盖，改为选择新位置', async () => {
  state.project.filePath = 'D:\\photo.ARW'
  state.pickSavePath.mockResolvedValue(null)
  expect(await useExport().save()).toBeNull()
  expect(state.pickSavePath).toHaveBeenCalledOnce()
  expect(state.writeBlob).not.toHaveBeenCalled()
})

it('手动在保存和导出对话框输入 RAW 扩展名也不能覆盖原件', async () => {
  state.pickSavePath.mockResolvedValue('D:\\photo.DNG')
  await expect(useExport().save()).rejects.toThrow('不能写入 RAW')
  await expect(useExport().run({ format: 'image/jpeg', quality: 0.9, keepExif: false })).rejects.toThrow('不能写入 RAW')
  expect(state.writeBlob).not.toHaveBeenCalled()
})
