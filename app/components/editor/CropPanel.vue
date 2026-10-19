<script setup lang="ts">
import { applyCropAspect, cropOutputSize, defaultCrop, MAX_STRAIGHTEN_ANGLE } from '~/lib/geometry/crop'
import { useEditorStore } from '~/stores/editor'

const editor = useEditorStore()
const meta = computed(() => editor.project!)
const crop = computed(() => editor.doc.crop ?? defaultCrop())
const outputSize = computed(() => cropOutputSize(crop.value, meta.value.width, meta.value.height))

const aspectItems = computed(() => [
  { label: '自由比例', value: 'free' },
  { label: '原图比例', value: String(meta.value.width / meta.value.height) },
  { label: '1:1', value: '1' },
  { label: '4:3', value: String(4 / 3) },
  { label: '3:2', value: String(3 / 2) },
  { label: '16:9', value: String(16 / 9) },
  { label: '3:4', value: String(3 / 4) },
  { label: '2:3', value: String(2 / 3) },
  { label: '9:16', value: String(9 / 16) }
])

const aspectValue = computed({
  get: () => editor.cropAspect === null ? 'free' : String(editor.cropAspect),
  set: (value: string) => {
    const aspect = value === 'free' ? null : Number(value)
    editor.cropAspect = aspect
    if (aspect) {
      editor.setCrop(applyCropAspect(crop.value, aspect, meta.value.width, meta.value.height))
    }
  }
})

function setAngle(angle: number) {
  editor.setCrop({ rect: crop.value.rect, angle }, 'crop-angle')
}
</script>

<template>
  <div class="space-y-5">
    <EditorParamSlider
      :model-value="crop.angle"
      label="水平校正"
      :min="-MAX_STRAIGHTEN_ANGLE"
      :max="MAX_STRAIGHTEN_ANGLE"
      :step="0.1"
      :format="v => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`"
      hint="旋转后裁剪框会自动收缩，避免出现空白角"
      @update:model-value="setAngle"
    />
    <UFormField label="长宽比">
      <USelect
        v-model="aspectValue"
        :items="aspectItems"
        class="w-full"
      />
    </UFormField>
    <p class="text-xs text-muted">
      输出尺寸 {{ outputSize.w }}×{{ outputSize.h }}
    </p>
    <div class="flex gap-2">
      <UButton
        icon="i-lucide-rotate-ccw"
        label="清除裁剪"
        color="neutral"
        variant="outline"
        block
        :disabled="!editor.doc.crop"
        @click="editor.setCrop(null)"
      />
      <UButton
        icon="i-lucide-check"
        label="完成"
        block
        @click="editor.tool = 'move'"
      />
    </div>
  </div>
</template>
