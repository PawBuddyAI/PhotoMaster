<script setup lang="ts">
import { IMAGE_MODEL_GROUP } from '~/lib/llm/models'
import { useSettingsStore } from '~/stores/settings'

/**
 * 配置向导：启动时没有读图 Key（或模型）就浮在图库之上，分三步填好跑通 AI 功能的必填项——欢迎、连接 AI 服务、选择模型。
 * 应用的功能都依赖 AI，不配置就用不了，所以不能跳过：没有「稍后设置」与关闭按钮，Esc 和点到弹窗外也关不掉，只能在最后一步配好后「开始使用」。
 * 只覆盖接口地址、Key 与两个模型名，思考等级、修图质量等留在设置页；填写的内容直接写进设置，中途刷新或退出也不丢。
 * 连接一步推荐登录 PawBuddy 账户：授权后接口、Key 与模型都由账户预设，最后一步不再选模型，改为「准备就绪」的确认。
 */
const settings = useSettingsStore()
const { testing, testVision, testImage } = useConnectionTest()

// 向导面向不熟悉 AI 接口的普通用户：除自带接口那一栏外，文案避开 Base URL、OpenAI 兼容、图层这类术语
const STEPS = [
  { title: '欢迎使用 AI 修图', description: '让 AI 帮你看照片、出主意，还能直接动手修' },
  { title: '连接 AI 服务', description: '登录 PawBuddy 账户最省事；熟悉 API 的话，也可以填写自己的接口' },
  { title: '选择模型', description: '一般保持默认就好，也可以从列表里换一个；更多选项之后可以在设置里调整' }
]
const LAST_STEP = STEPS.length - 1
/** 连着 PawBuddy 账户时模型由账户预设、不显示，最后一步只用来确认与测试连接 */
const PAWBUDDY_LAST_STEP = { title: '准备就绪', description: '点「开始使用」就可以修照片了' }

const HIGHLIGHTS = [
  { icon: 'i-lucide-scan-eye', title: 'AI 帮你看照片', description: '指出偏暗、偏色、拍歪等问题，还能帮你去掉路人、换个天空' },
  { icon: 'i-lucide-undo-2', title: '不满意随时改回来', description: '每一处修改都能单独微调、隐藏或删除，原图始终保留' },
  { icon: 'i-lucide-hard-drive', title: '照片保存在这台设备上', description: '只有用到 AI 功能时，才会把照片发给你连接的 AI 服务' }
]

// 启动时没配好就打开，走完才关：向导打开期间填好 Key 后 isVisionReady 变真，向导也不能自己关掉
const open = ref(settings.setupPending)
// 网页版登录 PawBuddy 会整页跳走，跳回时已经连上账户，直接打开最后一步
const step = ref(settings.pawbuddy ? LAST_STEP : 0)
const body = useTemplateRef('body')

// 桌面版在浏览器里授权后经深链回来，向导还停在连接这一步，连上后同样跳到最后一步
watch(() => settings.pawbuddy, (account, previous) => {
  if (account && !previous && step.value === 1) {
    step.value = LAST_STEP
  }
})

const current = computed(() => step.value === LAST_STEP && settings.pawbuddy ? PAWBUDDY_LAST_STEP : STEPS[step.value]!)
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
/** 要点列表：欢迎页介绍功能；连着 PawBuddy 账户时最后一步说明已经替用户配好了什么 */
const highlights = computed(() => {
  if (step.value === 0) {
    return HIGHLIGHTS
  }
  if (step.value === LAST_STEP && settings.pawbuddy) {
    return [
      { icon: 'i-lucide-circle-check', title: '已连接 PawBuddy 账户', description: settings.pawbuddy.email || '断开或充值都在设置里' },
      { icon: 'i-lucide-sparkles', title: '模型已经配好', description: '看照片和修图用的模型都由账户提供，不用自己选' },
      { icon: 'i-lucide-wallet', title: '用多少扣多少', description: '每次用 AI 按用量从账户余额里扣，余额不够时可以在设置里充值' }
    ]
  }
  return null
})
const imageModelHint = computed(() => settings.image.sameAsVision
  ? '负责去路人、换天空这类局部修改，和上面用同一个服务'
  : '负责去路人、换天空这类局部修改，使用设置里单独填写的服务')

/**
 * 换步时焦点进入新的一步：有输入框时落在第一个输入框上，否则交给弹窗本身，回车即「继续」。
 * 否则焦点留在原来的按钮上，从第二步「返回」回到第一步时那个按钮已经消失，焦点会丢到页面上
 */
watch(step, async () => {
  await nextTick()
  const target = body.value?.querySelector('input') ?? body.value?.closest<HTMLElement>('[role="dialog"]')
  target?.focus()
})

function finish() {
  settings.finishSetup()
  open.value = false
}

function next() {
  if (step.value < LAST_STEP) {
    step.value++
  } else {
    finish()
  }
}

/** 第一步没有「返回」按钮，只会在第二步起被调用 */
function back() {
  step.value--
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
    :close="false"
    :dismissible="false"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <div
        ref="body"
        class="flex min-h-82 flex-col gap-4"
        :class="{ 'justify-center': step === 0 }"
      >
        <!-- 欢迎页内容少，三步等高留出的空白用应用图标填上，与启动画面同一个图标源文件 -->
        <img
          v-if="step === 0"
          src="/app-icon.svg"
          alt=""
          draggable="false"
          class="mx-auto mb-2 size-16 shrink-0"
        >
        <ul
          v-if="highlights"
          class="flex flex-col gap-4"
          :class="{ 'mx-auto w-full max-w-md': step === 0 }"
        >
          <li
            v-for="item in highlights"
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

        <template v-if="step === 1">
          <div class="divide-y divide-default rounded-xl border border-default">
            <SettingsPawBuddyAccount />
          </div>
          <template v-if="!settings.pawbuddy">
            <p class="text-sm text-muted">
              或者使用自己的接口
            </p>
            <div class="divide-y divide-default rounded-xl border border-default">
              <SettingsConnectionFields
                v-model:base-url="settings.vision.baseURL"
                v-model:api-key="settings.vision.apiKey"
              />
            </div>
          </template>
        </template>

        <template v-else-if="step === LAST_STEP">
          <div
            v-if="!settings.pawbuddy"
            class="divide-y divide-default rounded-xl border border-default"
          >
            <SettingsRow
              label="读图模型"
              description="负责看照片、给出修图建议，需要能识别图片"
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
              {{ settings.pawbuddy ? '发一条很短的测试消息，确认能连上' : '发一条很短的测试消息，确认能连上、模型名称没填错' }}
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
          cancel-label="返回"
          :hide-cancel="step === 0"
          :confirm-label="step === LAST_STEP ? '开始使用' : '继续'"
          :disabled="!canContinue"
          @confirm="next"
          @cancel="back"
        />
      </div>
    </template>
  </UModal>
</template>
