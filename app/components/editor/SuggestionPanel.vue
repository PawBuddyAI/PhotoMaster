<script setup lang="ts">
import { ADJUST_PARAM_DEFS } from '~/lib/adjust/params'
import type { AnyCanvas } from '~/lib/image/canvas'
import type { AdjustParams, MaskSpec } from '~/lib/types'
import { useAnalysisStore } from '~/stores/analysis'
import { useEditorStore } from '~/stores/editor'
import { useSettingsStore } from '~/stores/settings'

const props = defineProps<{
  /** 当前预览结果，作为读图输入 */
  source: AnyCanvas | null
}>()

const editor = useEditorStore()
const analysis = useAnalysisStore()
const settings = useSettingsStore()
const notify = useNotify()
const hint = ref('')

const result = computed(() => editor.doc.analysis)
const adopted = computed(() => new Set(editor.doc.adopted))
const pendingAdjustments = computed(() => result.value?.adjustments.filter(s => !adopted.value.has(s.id)) ?? [])

const STRUCTURED_LABELS: Record<string, string> = { json_object: 'JSON 模式', none: '仅提示词约束' }

async function run() {
  if (!props.source) {
    return
  }
  try {
    await analysis.analyze(props.source, hint.value)
    if (analysis.downgradedTo) {
      notify.info('已自动调整结构化输出方式', `当前服务不支持 JSON Schema，已改用「${STRUCTURED_LABELS[analysis.downgradedTo]}」`)
    }
  } catch (err) {
    notify.error(err)
  }
}

function paramChips(params: AdjustParams): string[] {
  return ADJUST_PARAM_DEFS
    .filter(def => params[def.key] !== 0)
    .map((def) => {
      const value = params[def.key]
      const sign = value > 0 ? '+' : ''
      return `${def.label} ${sign}${def.key === 'exposure' ? value.toFixed(2) : Math.round(value)}`
    })
}

function regionLabel(mask: MaskSpec): string {
  const labels: Record<MaskSpec['shape'], string> = { full: '全图', none: '画笔', rect: '矩形区域', ellipse: '椭圆区域', linear: '渐变区域' }
  return labels[mask.shape]
}

function hover(mask: MaskSpec | null) {
  editor.hoverMask = mask
}

function adoptAllAdjustments() {
  pendingAdjustments.value.forEach(s => editor.adoptSuggestion(s.id))
}

onBeforeUnmount(() => hover(null))
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="!settings.isVisionReady"
      color="warning"
      variant="subtle"
      icon="i-lucide-key-round"
      title="尚未配置读图模型"
      description="配置后可以让 AI 分析照片并给出修图方案"
      :actions="[{ label: '前往设置', to: '/settings', color: 'neutral', variant: 'outline', size: 'lg' }]"
    />

    <UTextarea
      v-model="hint"
      :rows="2"
      autoresize
      :maxrows="5"
      placeholder="可选：补充你的偏好，例如“日系清新、保留暖色调”"
      class="w-full"
      :disabled="analysis.running"
    />
    <UButton
      v-if="!analysis.running"
      icon="i-lucide-sparkles"
      :label="result ? '重新分析当前效果' : '分析照片'"
      :disabled="!settings.isVisionReady || !source"
      block
      @click="run"
    />
    <UButton
      v-else
      icon="i-lucide-loader-circle"
      label="分析中，点击取消"
      color="neutral"
      variant="outline"
      block
      :ui="{ leadingIcon: 'animate-spin' }"
      @click="analysis.cancel()"
    />

    <template v-if="result">
      <p class="rounded-xl border border-default bg-default p-3 text-sm/relaxed text-default">
        {{ result.overall }}
      </p>

      <section
        v-if="result.adjustments.length"
        class="space-y-2"
      >
        <div class="flex items-center justify-between">
          <h3 class="section-title">
            调色建议
          </h3>
          <UButton
            v-if="pendingAdjustments.length > 1"
            label="全部采纳"
            color="neutral"
            variant="ghost"
            @click="adoptAllAdjustments"
          />
        </div>
        <div
          v-for="item in result.adjustments"
          :key="item.id"
          class="space-y-2 rounded-xl border border-default bg-default p-3 transition-colors duration-200 ease-out hover:border-accented hover:bg-(--mac-mid-hover)"
          @mouseenter="hover(item.mask.shape === 'full' ? null : item.mask)"
          @mouseleave="hover(null)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                {{ item.title }}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {{ item.reason }}
              </p>
            </div>
            <EditorAdoptAction
              :adopted="adopted.has(item.id)"
              @adopt="editor.adoptSuggestion(item.id)"
            />
          </div>
          <div class="flex flex-wrap gap-1">
            <UBadge
              :label="regionLabel(item.mask)"
              size="sm"
              color="neutral"
              variant="outline"
            />
            <UBadge
              v-for="chip in paramChips(item.params)"
              :key="chip"
              :label="chip"
              size="sm"
              color="neutral"
              variant="soft"
              class="tabular-nums"
            />
          </div>
        </div>
      </section>

      <section
        v-if="result.generativeEdits.length"
        class="space-y-2"
      >
        <h3 class="section-title">
          重绘建议
        </h3>
        <div
          v-for="item in result.generativeEdits"
          :key="item.id"
          class="space-y-2 rounded-xl border border-default bg-default p-3 transition-colors duration-200 ease-out hover:border-accented hover:bg-(--mac-mid-hover)"
          @mouseenter="hover(item.mask)"
          @mouseleave="hover(null)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                {{ item.title }}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {{ item.reason }}
              </p>
            </div>
            <EditorAdoptAction
              :adopted="adopted.has(item.id)"
              @adopt="editor.adoptSuggestion(item.id)"
            />
          </div>
          <p class="line-clamp-3 rounded-lg bg-deep px-2 py-1.5 font-mono text-[11px]/relaxed text-muted">
            {{ item.prompt }}
          </p>
        </div>
        <p class="text-xs text-muted">
          采纳后会新建重绘图层，可先微调区域再点击「生成」。
        </p>
      </section>

      <section
        v-if="result.crop"
        class="space-y-2"
      >
        <h3 class="section-title">
          构图建议
        </h3>
        <div class="flex items-start justify-between gap-2 rounded-xl border border-default bg-default p-3">
          <div class="min-w-0">
            <p class="text-sm text-highlighted">
              {{ result.crop.reason }}
            </p>
            <p class="mt-0.5 text-xs text-muted tabular-nums">
              水平校正 {{ result.crop.crop.angle.toFixed(1) }}°
            </p>
          </div>
          <EditorAdoptAction
            :adopted="adopted.has(result.crop.id)"
            @adopt="editor.adoptSuggestion(result.crop.id)"
          />
        </div>
      </section>

      <p class="text-xs text-muted">
        模型：{{ result.model }}
        <template v-if="analysis.lastUsage">
          · {{ analysis.lastUsage.total_tokens.toLocaleString() }} tokens
        </template>
      </p>
    </template>
  </div>
</template>
