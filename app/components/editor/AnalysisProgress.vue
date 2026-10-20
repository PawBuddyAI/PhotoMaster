<script setup lang="ts">
import type { AnalysisDraftItem, AnalysisProgress } from '~/lib/llm/analyze'

const props = defineProps<{ progress: AnalysisProgress }>()

/**
 * 分析进行中的实时进度：模型的思考过程，以及从正在写出的方案里提取的总评与建议标题。
 * 只展示这些可读文字，不展示 JSON。每次分析挂载一次，用时从挂载起算，格式不对重新生成时继续累计
 */

const KIND_META: Record<AnalysisDraftItem['kind'], { label: string, icon: string }> = {
  adjustment: { label: '调色', icon: 'i-lucide-sliders-horizontal' },
  generative: { label: '重绘', icon: 'i-lucide-wand-sparkles' },
  crop: { label: '构图', icon: 'i-lucide-crop' }
}

const phaseLabel = computed(() => {
  switch (props.progress.phase) {
    case 'thinking':
      return 'AI 正在思考'
    case 'writing':
      return 'AI 正在写修图方案'
    default:
      return props.progress.retrying ? '刚才的方案格式不对，正在重写' : 'AI 正在看照片'
  }
})

const thought = computed(() => props.progress.reasoning.trim())
const draft = computed(() => props.progress.draft)

const startedAt = Date.now()
const now = ref(startedAt)
const timer = setInterval(() => {
  now.value = Date.now()
}, 1000)
onBeforeUnmount(() => clearInterval(timer))

const elapsedLabel = computed(() => {
  const seconds = Math.round((now.value - startedAt) / 1000)
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
})

/** 思考过程跟着最新的文字滚到底；用户往上翻看时不打扰，翻回底部后继续跟随 */
const thoughtEl = useTemplateRef('thoughtEl')
let followTail = true

function onThoughtScroll() {
  const el = thoughtEl.value
  if (el) {
    followTail = el.scrollHeight - el.scrollTop - el.clientHeight < 16
  }
}

/** 思考区展开动画期间是 overflow: clip，滚动无效，展开结束后要再滚一次 */
function scrollToTail() {
  const el = thoughtEl.value
  if (el && followTail) {
    el.scrollTop = el.scrollHeight
  }
}

watch(thought, (next, previous) => {
  // 重新生成时思考过程从头开始，恢复跟随
  if (next.length < previous.length) {
    followTail = true
  }
  scrollToTail()
}, { flush: 'post' })
</script>

<template>
  <div class="space-y-3 rounded-xl border border-default p-3">
    <div class="flex items-center justify-between gap-2 text-xs">
      <span
        class="flex items-center gap-1.5 text-highlighted"
        aria-live="polite"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-3.5 animate-spin"
        />
        {{ phaseLabel }}
      </span>
      <span class="tabular-nums text-muted">{{ elapsedLabel }}</span>
    </div>

    <Transition
      name="reveal"
      @after-enter="scrollToTail"
    >
      <div
        v-if="thought"
        ref="thoughtEl"
        aria-label="AI 的思考过程"
        class="max-h-40 overflow-y-auto rounded-lg bg-deep px-2 py-1.5 text-xs/relaxed whitespace-pre-wrap text-muted"
        @scroll="onThoughtScroll"
        v-text="thought"
      />
    </Transition>

    <Transition name="reveal">
      <p
        v-if="draft.overall"
        class="text-sm/relaxed text-default"
      >
        {{ draft.overall }}
      </p>
    </Transition>

    <TransitionGroup
      v-if="draft.items.length"
      tag="ul"
      name="list"
      class="space-y-1.5"
    >
      <li
        v-for="(item, index) in draft.items"
        :key="index"
        class="flex items-start gap-2 text-sm text-default"
      >
        <UIcon
          :name="KIND_META[item.kind].icon"
          class="mt-0.5 size-4 shrink-0 text-muted"
        />
        <span class="min-w-0">
          <span class="sr-only">{{ KIND_META[item.kind].label }}：</span>{{ item.text }}
        </span>
      </li>
    </TransitionGroup>
  </div>
</template>
