import { createOpenAIClient } from '~/lib/llm/client'
import { probeStructuredOutput, STRUCTURED_OUTPUT_LABELS } from '~/lib/llm/probe'
import { useModelListStore } from '~/stores/models'
import { useSettingsStore } from '~/stores/settings'

/**
 * 读图、修图两组配置的「测试连接」：设置页与首次配置向导共用，结果以通知条提示。
 * 读图测试发一次极短的文本请求，并把探测到的结构化输出方式写回设置；修图测试只核对模型列表里有没有这个模型
 */
export function useConnectionTest() {
  const settings = useSettingsStore()
  const modelList = useModelListStore()
  const notify = useNotify()
  const testing = reactive({ vision: false, image: false })

  async function testVision(): Promise<void> {
    testing.vision = true
    try {
      const client = createOpenAIClient(settings.visionConnection, { timeout: 60_000 })
      const mode = await probeStructuredOutput(client, settings.vision.model, settings.vision.reasoningEffort)
      settings.vision.structuredOutput = mode
      notify.success('读图模型连接正常', `结构化输出方式：${STRUCTURED_OUTPUT_LABELS[mode]}`)
    } catch (err) {
      notify.error(err)
    } finally {
      testing.vision = false
    }
  }

  async function testImage(): Promise<void> {
    testing.image = true
    try {
      const models = await modelList.load(settings.imageConnection, { force: true })
      if (models?.includes(settings.image.model)) {
        notify.success('修图模型连接正常', `已在模型列表中找到 ${settings.image.model}`)
      } else if (models) {
        notify.warning('连接正常，但未找到该模型', `模型列表中没有 ${settings.image.model}，请确认模型名称`)
      } else {
        notify.info('连接正常', '该服务不提供模型列表接口，无法确认模型名称是否正确')
      }
    } catch (err) {
      notify.error(err)
    } finally {
      testing.image = false
    }
  }

  return { testing, testVision, testImage }
}
