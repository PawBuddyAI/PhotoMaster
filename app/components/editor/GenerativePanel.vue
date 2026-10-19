<script setup lang="ts">
import type { GenerativeLayer } from '~/lib/types'
import { useEditorStore } from '~/stores/editor'
import { useInpaintStore } from '~/stores/inpaint'
import { useSettingsStore } from '~/stores/settings'

const props = defineProps<{ layer: GenerativeLayer }>()
const editor = useEditorStore()
const inpaint = useInpaintStore()
const settings = useSettingsStore()
const notify = useNotify()

const job = computed(() => inpaint.jobs[props.layer.id] ?? null)
const running = computed(() => inpaint.isRunning(props.layer.id))
const selected = ref(0)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

const STAGE_LABELS = {
  preparing: '正在准备图像与蒙版',
  generating: '模型生成中',
  finalizing: '正在对齐色彩并合成',
  done: '生成完成，请挑选结果',
  error: '生成失败'
} as const

const elapsed = computed(() => job.value ? Math.max(0, Math.round((now.value - job.value.startedAt) / 1000)) : 0)

watch(running, (value) => {
  if (value) {
    timer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
}, { immediate: true })

watch(() => job.value?.candidates.length, () => {
  selected.value = 0
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

async function generate() {
  try {
    await inpaint.run(props.layer.id)
  } catch (err) {
    notify.error(err)
  }
}

async function apply() {
  try {
    await inpaint.apply(props.layer.id, selected.value)
    notify.success('已应用重绘结果', '可以随时撤销，或关闭图层对比效果')
  } catch (err) {
    notify.error(err)
  }
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="!settings.isImageReady"
      color="warning"
      variant="subtle"
      icon="i-lucide-key-round"
      title="尚未配置修图模型"
      :actions="[{ label: '前往设置', to: '/settings', color: 'warning', variant: 'link' }]"
    />

    <UFormField
      label="重绘指令"
      description="描述区域内修改后应呈现的内容，中英文均可"
    >
      <UTextarea
        :model-value="layer.prompt"
        :rows="3"
        autoresize
        :maxrows="8"
        placeholder="例如：移除画面中的行人，用与周围一致的石板路补全"
        class="w-full"
        :disabled="running"
        @update:model-value="value => editor.updatePrompt(layer.id, String(value))"
      />
    </UFormField>

    <div class="flex gap-2">
      <UButton
        v-if="!running"
        icon="i-lucide-wand-sparkles"
        :label="layer.result ? '重新生成' : '生成'"
        :disabled="!settings.isImageReady || !layer.prompt.trim()"
        block
        @click="generate"
      />
      <UButton
        v-else
        icon="i-lucide-square"
        label="取消生成"
        color="neutral"
        variant="outline"
        block
        @click="inpaint.cancel(layer.id)"
      />
    </div>

    <div
      v-if="job"
      class="space-y-3 rounded-md border border-default p-3"
    >
      <div class="flex items-center justify-between gap-2 text-xs">
        <span
          class="flex items-center gap-1.5"
          :class="job.stage === 'error' ? 'text-error' : 'text-default'"
        >
          <UIcon
            v-if="running"
            name="i-lucide-loader-circle"
            class="size-3.5 animate-spin"
          />
          {{ STAGE_LABELS[job.stage] }}
        </span>
        <span
          v-if="running"
          class="tabular-nums text-muted"
        >{{ elapsed }} 秒</span>
      </div>
      <p class="text-xs text-dimmed">
        编辑分辨率 {{ job.plan.outW }}×{{ job.plan.outH }}，对应原图区域 {{ job.plan.crop.w }}×{{ job.plan.crop.h }}
      </p>
      <p
        v-if="job.plan.distortion > 0.02"
        class="text-xs text-warning"
      >
        区域过于狭长，超出模型支持的 3:1 比例，结果会有轻微拉伸；建议缩小区域后分段重绘。
      </p>
      <UProgress
        v-if="running"
        size="xs"
      />

      <div
        v-if="job.partialUrls.length"
        class="grid grid-cols-2 gap-2"
      >
        <img
          v-for="(url, i) in job.partialUrls"
          :key="i"
          :src="url"
          alt="生成中间结果"
          class="aspect-square w-full rounded object-cover opacity-80"
        >
      </div>

      <p
        v-if="job.error"
        class="text-xs text-error"
      >
        {{ job.error.title }}：{{ job.error.description }}
      </p>

      <template v-if="job.candidates.length">
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="(candidate, i) in job.candidates"
            :key="candidate.previewUrl"
            type="button"
            class="relative overflow-hidden rounded border-2 transition"
            :class="selected === i ? 'border-primary' : 'border-transparent hover:border-accented'"
            @click="selected = i"
          >
            <img
              :src="candidate.previewUrl"
              :alt="`候选 ${i + 1}`"
              class="w-full object-contain"
            >
            <span class="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] text-white">{{ i + 1 }}</span>
          </button>
        </div>
        <p
          v-if="job.usage"
          class="text-xs text-dimmed"
        >
          本次消耗 {{ job.usage.totalTokens.toLocaleString() }} tokens（输入 {{ job.usage.inputTokens.toLocaleString() }} / 输出 {{ job.usage.outputTokens.toLocaleString() }}）
        </p>
        <div class="flex gap-2">
          <UButton
            icon="i-lucide-check"
            label="应用所选"
            block
            @click="apply"
          />
          <UButton
            icon="i-lucide-x"
            label="丢弃"
            color="neutral"
            variant="ghost"
            @click="inpaint.discard(layer.id)"
          />
        </div>
      </template>
    </div>

    <div
      v-if="layer.result && !job"
      class="flex items-center justify-between gap-2 rounded-md bg-elevated/60 p-3 text-xs"
    >
      <span class="flex items-center gap-1.5 text-success">
        <UIcon
          name="i-lucide-circle-check"
          class="size-3.5"
        />
        已应用重绘结果
      </span>
      <UButton
        label="移除结果"
        color="neutral"
        variant="link"
        size="xs"
        @click="editor.setGenerativeResult(layer.id, null)"
      />
    </div>
  </div>
</template>
