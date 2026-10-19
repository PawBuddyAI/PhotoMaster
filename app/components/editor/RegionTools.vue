<script setup lang="ts">
import { defaultFeather } from '~/lib/mask/spec'
import type { Layer, MaskShape } from '~/lib/types'
import { useEditorStore } from '~/stores/editor'

const props = defineProps<{
  layer: Layer
  /** 已生成结果或正在生成时锁定区域 */
  locked: boolean
}>()

const editor = useEditorStore()
const isGenerative = computed(() => props.layer.kind === 'generative')
const mask = computed(() => props.layer.mask)

const shapeOptions = computed(() => {
  const all: Array<{ value: MaskShape, label: string, icon: string }> = [
    { value: 'full', label: '全图', icon: 'i-lucide-maximize' },
    { value: 'rect', label: '矩形', icon: 'i-lucide-square' },
    { value: 'ellipse', label: '椭圆', icon: 'i-lucide-circle' },
    { value: 'linear', label: '渐变', icon: 'i-lucide-blend' },
    { value: 'none', label: '仅画笔', icon: 'i-lucide-brush' }
  ]
  // 局部重绘需要明确的边界，不提供全图和线性渐变
  return isGenerative.value ? all.filter(o => o.value !== 'full' && o.value !== 'linear') : all
})

const hasFeather = computed(() => mask.value.shape === 'rect' || mask.value.shape === 'ellipse')

function setShape(shape: MaskShape) {
  editor.updateMask(props.layer.id, { shape, feather: defaultFeather(shape) })
  if (shape === 'none') {
    editor.tool = 'brush'
  }
}

function update(patch: Parameters<typeof editor.updateMask>[1], key: string) {
  editor.updateMask(props.layer.id, patch, `mask:${props.layer.id}:${key}`)
}

const brushPercent = computed({
  get: () => editor.brush.radius * 100,
  set: (value: number) => {
    editor.brush.radius = value / 100
  }
})
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-2">
      <p class="text-xs font-semibold tracking-wide text-muted">
        区域
      </p>
      <div class="grid grid-cols-5 gap-1">
        <UTooltip
          v-for="option in shapeOptions"
          :key="option.value"
          :text="option.label"
        >
          <UButton
            :icon="option.icon"
            :color="mask.shape === option.value ? 'primary' : 'neutral'"
            :variant="mask.shape === option.value ? 'soft' : 'ghost'"
            :disabled="locked"
            :aria-label="option.label"
            block
            @click="setShape(option.value)"
          />
        </UTooltip>
      </div>
      <p
        v-if="mask.shape === 'linear'"
        class="text-xs text-dimmed"
      >
        拖动画布上的两个端点：起点效果最强，终点效果为零
      </p>
    </div>

    <EditorParamSlider
      v-if="hasFeather"
      :model-value="mask.feather"
      label="羽化"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="defaultFeather(mask.shape)"
      :disabled="locked"
      :format="v => `${Math.round(v * 100)}%`"
      @update:model-value="v => update({ feather: v }, 'feather')"
    />
    <EditorParamSlider
      :model-value="mask.density"
      label="强度"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="1"
      :disabled="locked"
      :format="v => `${Math.round(v * 100)}%`"
      @update:model-value="v => update({ density: v }, 'density')"
    />
    <USwitch
      v-if="!isGenerative"
      :model-value="mask.invert"
      label="反转形状"
      size="sm"
      :disabled="locked || mask.shape === 'none'"
      @update:model-value="v => editor.updateMask(layer.id, { invert: v })"
    />

    <USeparator />

    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs font-semibold tracking-wide text-muted">
          画笔
        </p>
        <UButton
          v-if="mask.strokes.length"
          :label="`清除 ${mask.strokes.length} 笔`"
          icon="i-lucide-eraser"
          color="neutral"
          variant="link"
          size="xs"
          :disabled="locked"
          @click="editor.clearStrokes(layer.id)"
        />
      </div>
      <div class="grid grid-cols-2 gap-1">
        <UButton
          icon="i-lucide-brush"
          label="添加"
          :color="editor.tool === 'brush' ? 'primary' : 'neutral'"
          :variant="editor.tool === 'brush' ? 'soft' : 'outline'"
          :disabled="locked"
          block
          @click="editor.tool = editor.tool === 'brush' ? 'move' : 'brush'"
        />
        <UButton
          icon="i-lucide-eraser"
          label="擦除"
          :color="editor.tool === 'erase' ? 'primary' : 'neutral'"
          :variant="editor.tool === 'erase' ? 'soft' : 'outline'"
          :disabled="locked"
          block
          @click="editor.tool = editor.tool === 'erase' ? 'move' : 'erase'"
        />
      </div>
      <EditorParamSlider
        v-model="brushPercent"
        label="笔刷大小"
        :min="0.2"
        :max="20"
        :step="0.1"
        :default-value="3"
        hint="相对图片长边的半径，快捷键 [ ]"
        :format="v => `${v.toFixed(1)}%`"
      />
      <EditorParamSlider
        v-model="editor.brush.hardness"
        label="硬度"
        :min="0"
        :max="1"
        :step="0.01"
        :default-value="0.5"
        :format="v => `${Math.round(v * 100)}%`"
      />
    </div>

    <USwitch
      v-model="editor.showMaskOverlay"
      label="显示区域叠加"
      size="sm"
    />
  </div>
</template>
