import { ref } from 'vue'
import { buildRawProfile } from '~/lib/image/raw-develop'
import { readRawMetadata } from '~/lib/image/raw-meta'
import { getBlob, getProject } from '~/lib/storage/db'
import { useEditorStore } from '~/stores/editor'
import { useImageWorker } from './useImageWorker'
import { useProjectAssets } from './useProjectAssets'

const analyzing = ref(false)
let pending: Promise<void> | null = null

/**
 * 旧 RAW 工程没有导入时的分析结果：从保存的原件读内嵌预览与 BaselineExposure，
 * 用已加载的预览底图拟合风格，从主数据读小块估计噪声，结果写回工程记录。新导入的工程直接跳过。
 */
export function useRawProfile() {
  async function ensure(): Promise<void> {
    const editor = useEditorStore()
    const meta = editor.project
    if (!meta?.raw || meta.rawProfile) return
    pending ??= (async () => {
      analyzing.value = true
      try {
        const assets = useProjectAssets()
        const record = await getProject(meta.id)
        if (!record?.rawSource || !assets.linearPreview.value || !assets.linearBlob.value) throw new Error('RAW 原件或底图尚未加载，请重新打开工程。')
        const { metadata, preview } = await readRawMetadata(await getBlob(record.rawSource.blobId), true)
        const noise = await useImageWorker().rawNoise(assets.linearBlob.value)
        const profile = buildRawProfile(assets.linearPreview.value, preview, noise, metadata.color_data?.dng_levels?.baseline_exposure)
        if (editor.project?.id === meta.id) await editor.setRawProfile(profile)
      } finally {
        analyzing.value = false
        pending = null
      }
    })()
    return pending
  }

  return { analyzing, ensure }
}
