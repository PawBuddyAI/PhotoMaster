<script setup lang="ts">
import { VISION_MAX_SIDE } from '~/lib/llm/analyze'
import { createOpenAIClient } from '~/lib/llm/client'
import { probeStructuredOutput } from '~/lib/llm/probe'
import { useModelListStore } from '~/stores/models'
import { useSettingsStore } from '~/stores/settings'

const settings = useSettingsStore()
const modelList = useModelListStore()
const notify = useNotify()
const testing = reactive({ vision: false, image: false })

const structuredOutputItems = [
  { label: 'JSON Schema（严格结构化，推荐）', value: 'json_schema' },
  { label: 'JSON 模式', value: 'json_object' },
  { label: '仅提示词约束', value: 'none' }
]
const STRUCTURED_LABELS: Record<string, string> = Object.fromEntries(structuredOutputItems.map(i => [i.value, i.label]))
const reasoningEffortItems = [
  { label: '模型默认', value: 'default' },
  { label: '关闭（none）', value: 'none' },
  { label: '最少（minimal）', value: 'minimal' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '超高（xhigh）', value: 'xhigh' },
  { label: '最高（max）', value: 'max' }
]
const detailItems = [
  { label: '高（推荐）', value: 'high' },
  { label: '自动', value: 'auto' },
  { label: '低（省 token）', value: 'low' }
]
const qualityItems = [
  { label: '自动', value: 'auto' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '超高（xhigh）', value: 'xhigh' },
  { label: '最高（max）', value: 'max' }
]
/** 数字输入的增减按钮用中性色，强调色只留给选中与焦点 */
const STEPPER = { color: 'neutral' as const }
/** 修图模型下拉中优先列出的图像模型 */
const IMAGE_MODELS = { label: '图像模型', pattern: /image|dall-e/i }
const sizeModeItems = [
  { label: '自定义尺寸（gpt-image-2 及以后）', value: 'custom' },
  { label: '固定尺寸（1024² / 1536×1024 / 1024×1536）', value: 'fixed' }
]

async function testVision() {
  testing.vision = true
  try {
    const client = createOpenAIClient(settings.visionConnection, { timeout: 60_000 })
    const mode = await probeStructuredOutput(client, settings.vision.model, settings.vision.reasoningEffort)
    settings.vision.structuredOutput = mode
    notify.success('读图模型连接正常', `结构化输出方式：${STRUCTURED_LABELS[mode]}`)
  } catch (err) {
    notify.error(err)
  } finally {
    testing.vision = false
  }
}

async function testImage() {
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
</script>

<template>
  <UDashboardPanel
    id="settings"
    :ui="{ root: 'bg-deep' }"
  >
    <template #header>
      <UDashboardNavbar title="设置" />
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <section
          aria-labelledby="vision-heading"
          class="flex flex-col gap-3"
        >
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div class="min-w-0">
              <h2
                id="vision-heading"
                class="section-title"
              >
                读图模型
              </h2>
              <p class="mt-0.5 text-sm text-pretty text-muted">
                分析照片并给出调色、重绘与构图建议，需要支持图像输入
              </p>
            </div>
            <UButton
              icon="i-lucide-plug-zap"
              label="测试连接"
              color="neutral"
              variant="outline"
              :loading="testing.vision"
              :disabled="!settings.isVisionReady"
              @click="testVision"
            />
          </div>
          <div class="divide-y divide-default rounded-xl border border-default bg-default">
            <SettingsConnectionFields
              v-model:base-url="settings.vision.baseURL"
              v-model:api-key="settings.vision.apiKey"
              v-model:use-proxy="settings.vision.useProxy"
            />
            <SettingsRow
              label="模型"
              description="可从服务的模型列表中选择或直接输入，例如 gpt-6.1-sol；想节省成本可用 gpt-6-luna"
            >
              <SettingsModelPicker
                v-model="settings.vision.model"
                :connection="settings.visionConnection"
              />
            </SettingsRow>
            <SettingsRow
              label="思考等级"
              description="仅推理模型有效，越高越细致、越慢越贵；「模型默认」不发送该参数"
            >
              <USelect
                v-model="settings.vision.reasoningEffort"
                :items="reasoningEffortItems"
                class="w-full"
              />
            </SettingsRow>
            <SettingsRow
              label="结构化输出"
              description="测试连接会自动检测"
            >
              <USelect
                v-model="settings.vision.structuredOutput"
                :items="structuredOutputItems"
                class="w-full"
              />
            </SettingsRow>
            <SettingsRow
              label="图像细节"
              :description="`图片发送前统一缩放到 ${VISION_MAX_SIDE}×${VISION_MAX_SIDE} 以内`"
            >
              <USelect
                v-model="settings.vision.detail"
                :items="detailItems"
                class="w-full"
              />
            </SettingsRow>
          </div>
        </section>

        <section
          aria-labelledby="image-heading"
          class="flex flex-col gap-3"
        >
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div class="min-w-0">
              <h2
                id="image-heading"
                class="section-title"
              >
                修图模型
              </h2>
              <p class="mt-0.5 text-sm text-pretty text-muted">
                通过 /v1/images/edits 对蒙版区域做局部重绘
              </p>
            </div>
            <UButton
              icon="i-lucide-plug-zap"
              label="测试连接"
              color="neutral"
              variant="outline"
              :loading="testing.image"
              :disabled="!settings.isImageReady"
              @click="testImage"
            />
          </div>
          <div class="divide-y divide-default rounded-xl border border-default bg-default">
            <SettingsRow
              label="沿用读图模型的连接配置"
              toggle
            >
              <USwitch v-model="settings.image.sameAsVision" />
            </SettingsRow>
            <SettingsConnectionFields
              v-if="!settings.image.sameAsVision"
              v-model:base-url="settings.image.baseURL"
              v-model:api-key="settings.image.apiKey"
              v-model:use-proxy="settings.image.useProxy"
            />
            <SettingsRow
              label="模型"
              description="可从模型列表中选择或直接输入；gpt-image-2.5-sunburst 编辑精度更高，gpt-image-2.5-flare 更快"
            >
              <SettingsModelPicker
                v-model="settings.image.model"
                :connection="settings.imageConnection"
                :preferred="IMAGE_MODELS"
              />
            </SettingsRow>
            <SettingsRow label="质量">
              <USelect
                v-model="settings.image.quality"
                :items="qualityItems"
                class="w-full"
              />
            </SettingsRow>
            <SettingsRow
              label="候选数量"
              description="每次生成几张供挑选"
            >
              <UInputNumber
                v-model="settings.image.n"
                :increment="STEPPER"
                :decrement="STEPPER"
                :min="1"
                :max="4"
                class="w-full"
              />
            </SettingsRow>
            <SettingsRow
              label="尺寸模式"
              description="旧模型或兼容服务不支持任意尺寸时选择固定尺寸"
            >
              <USelect
                v-model="settings.image.sizeMode"
                :items="sizeModeItems"
                class="w-full"
              />
            </SettingsRow>
            <SettingsRow
              v-if="settings.image.sizeMode === 'custom'"
              label="编辑分辨率长边上限"
              description="越大细节越好、成本越高"
            >
              <UInputNumber
                v-model="settings.image.maxLongSide"
                :increment="STEPPER"
                :decrement="STEPPER"
                :min="settings.maxLongSideRange.min"
                :max="settings.maxLongSideRange.max"
                :step="128"
                class="w-full"
              />
            </SettingsRow>
            <SettingsRow
              label="流式返回中间结果"
              description="生成过程中实时显示预览；服务需支持 stream 参数"
              toggle
            >
              <USwitch v-model="settings.image.stream" />
            </SettingsRow>
            <SettingsRow
              v-if="settings.image.stream"
              label="中间图数量"
            >
              <UInputNumber
                v-model="settings.image.partialImages"
                :increment="STEPPER"
                :decrement="STEPPER"
                :min="0"
                :max="3"
                class="w-full"
              />
            </SettingsRow>
          </div>
        </section>

        <div class="flex justify-end">
          <UButton
            icon="i-lucide-rotate-ccw"
            label="恢复默认设置"
            color="neutral"
            variant="ghost"
            @click="settings.reset()"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
