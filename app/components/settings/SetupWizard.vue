<script setup lang="ts">
import { IMAGE_MODEL_GROUP } from '~/lib/llm/models'
import { useSettingsStore } from '~/stores/settings'

/**
 * 首次配置向导：第一次打开应用时浮在图库之上，分三步填好跑通 AI 功能的必填项——欢迎、连接接口、选择模型。
 * 只覆盖接口地址、Key 与两个模型名，思考等级、修图质量等留在设置页；填写的内容直接写进设置，中途跳过也不丢。
 * 走完、点「稍后设置」、右上角关闭或按 Esc 都记为已完成，以后不再弹出；没配好时图库顶部的提示条仍然指向设置页。
 */
const settings = useSettingsStore()
const { testing, testVision, testImage } = useConnectionTest()

const STEPS = [
  { title: '欢迎使用 AI 修图', description: '先花一分钟连上你的模型接口' },
  { title: '连接模型接口', description: '读图建议与局部重绘都通过这个 OpenAI 兼容接口完成，修图默认沿用同一个接口' },
  { title: '选择模型', description: '可从服务的模型列表中选择，也可以直接输入名称；思考等级、修图质量等更多选项在设置里' }
]
const LAST_STEP = STEPS.length - 1

const HIGHLIGHTS = [
  { icon: 'i-lucide-scan-eye', title: 'AI 读图给方案', description: '多模态模型分析照片，给出调色、重绘与构图建议' },
  { icon: 'i-lucide-layers', title: '每条建议都是图层', description: '采纳后可以继续微调、关闭或删除，随时对比原图' },
  { icon: 'i-lucide-hard-drive', title: '照片只存在本机', description: '只在使用 AI 功能时发送给你配置的接口' }
]

// 只在启动时决定一次：向导打开期间填好 Key 后 isVisionReady 变真，向导不能自己关掉
const open = ref(!settings.setupDone)
const step = ref(0)
const body = useTemplateRef('body')

const current = computed(() => STEPS[step.value]!)
const canContinue = computed(() => {
  switch (step.value) {
    case 1:
      return !!settings.vision.baseURL.trim() && !!settings.vision.apiKey.trim()
    case LAST_STEP:
      return settings.isVisionReady
    default:
      return true
  }
})
const imageModelHint = computed(() => settings.image.sameAsVision
  ? '局部重绘用的图像模型，沿用上一步的接口'
  : '局部重绘用的图像模型，使用设置里单独配置的接口')

/**
 * 换步时焦点进入新的一步：有输入框时落在第一个输入框上，否则交给弹窗本身，回车即「继续」。
 * 否则焦点留在原来的按钮上，从第二步「返回」后同一个按钮已变成「稍后设置」，再按一次回车就跳过了
 */
watch(step, async () => {
  await nextTick()
  const target = body.value?.querySelector('input') ?? body.value?.closest<HTMLElement>('[role="dialog"]')
  target?.focus()
})

function finish() {
  settings.completeSetup()
  open.value = false
}

function next() {
  if (step.value < LAST_STEP) {
    step.value++
  } else {
    finish()
  }
}

function back() {
  if (step.value > 0) {
    step.value--
  } else {
    finish()
  }
}

function onOpenChange(value: boolean) {
  if (!value) {
    finish()
  }
}

/** 点到弹窗外（包括通知条）不算关闭：向导关掉就不会再弹，误触的代价太大 */
function keepOpenOnOutside(event: Event) {
  event.preventDefault()
}

async function testConnection() {
  await Promise.all([testVision(), settings.isImageReady ? testImage() : undefined])
}
</script>

<template>
  <UModal
    :open="open"
    :title="current.title"
    :description="current.description"
    :content="{ onInteractOutside: keepOpenOnOutside }"
    :ui="{ content: 'max-w-2xl' }"
    @update:open="onOpenChange"
  >
    <template #body>
      <div
        ref="body"
        class="flex min-h-64 flex-col gap-4"
      >
        <template v-if="step === 0">
          <ul class="flex flex-col gap-4">
            <li
              v-for="item in HIGHLIGHTS"
              :key="item.title"
              class="flex gap-3"
            >
              <UIcon
                :name="item.icon"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">
                  {{ item.title }}
                </p>
                <p class="text-sm text-pretty text-muted">
                  {{ item.description }}
                </p>
              </div>
            </li>
          </ul>
          <p class="mt-auto text-sm text-pretty text-muted">
            需要一个 OpenAI 兼容接口（Base URL 与 API Key）。暂时没有也可以先跳过，手动调色、裁剪和导出不受影响。
          </p>
        </template>

        <div
          v-else-if="step === 1"
          class="divide-y divide-default rounded-xl border border-default"
        >
          <SettingsConnectionFields
            v-model:base-url="settings.vision.baseURL"
            v-model:api-key="settings.vision.apiKey"
            v-model:use-proxy="settings.vision.useProxy"
          />
        </div>

        <template v-else>
          <div class="divide-y divide-default rounded-xl border border-default">
            <SettingsRow
              label="读图模型"
              description="分析照片并给出建议，需要支持图像输入"
            >
              <SettingsModelPicker
                v-model="settings.vision.model"
                :connection="settings.visionConnection"
              />
            </SettingsRow>
            <SettingsRow
              label="修图模型"
              :description="imageModelHint"
            >
              <SettingsModelPicker
                v-model="settings.image.model"
                :connection="settings.imageConnection"
                :preferred="IMAGE_MODEL_GROUP"
              />
            </SettingsRow>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 flex-1 text-sm text-pretty text-muted">
              测试会发送一次很短的文本请求，并自动检测结构化输出方式
            </p>
            <UButton
              icon="i-lucide-plug-zap"
              label="测试连接"
              color="neutral"
              variant="outline"
              :loading="testing.vision || testing.image"
              :disabled="!settings.isVisionReady"
              @click="testConnection"
            />
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center gap-4">
        <ol
          :aria-label="`第 ${step + 1} 步，共 ${STEPS.length} 步`"
          class="flex shrink-0 gap-1.5"
        >
          <li
            v-for="(item, index) in STEPS"
            :key="item.title"
            :aria-current="index === step ? 'step' : undefined"
            class="size-1.5 rounded-full transition-colors duration-200 ease-out"
            :class="index === step ? 'bg-(--ui-text-muted)' : 'bg-accented'"
          >
            <span class="sr-only">{{ item.title }}</span>
          </li>
        </ol>
        <DialogActions
          class="min-w-0 flex-1"
          :cancel-label="step === 0 ? '稍后设置' : '返回'"
          :confirm-label="step === LAST_STEP ? '开始使用' : '继续'"
          :disabled="!canContinue"
          @confirm="next"
          @cancel="back"
        />
      </div>
    </template>
  </UModal>
</template>
