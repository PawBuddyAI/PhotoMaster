<script setup lang="ts">
import { ADJUST_GROUP_LABELS, ADJUST_PARAM_DEFS, type AdjustParamDef } from '~/lib/adjust/params'
import type { AdjustmentLayer } from '~/lib/types'
import { useEditorStore } from '~/stores/editor'

const props = defineProps<{ layer: AdjustmentLayer }>()
const editor = useEditorStore()

const groups = (['light', 'color', 'detail'] as const).map(group => ({
  key: group,
  label: ADJUST_GROUP_LABELS[group],
  defs: ADJUST_PARAM_DEFS.filter(def => def.group === group)
}))

function formatValue(def: AdjustParamDef, value: number): string {
  const sign = value > 0 ? '+' : ''
  return def.key === 'exposure' ? `${sign}${value.toFixed(2)} EV` : `${sign}${Math.round(value)}`
}
</script>

<template>
  <div class="space-y-5">
    <section
      v-for="group in groups"
      :key="group.key"
      class="space-y-3"
    >
      <p class="text-xs font-semibold tracking-wide text-muted">
        {{ group.label }}
      </p>
      <EditorParamSlider
        v-for="def in group.defs"
        :key="def.key"
        :model-value="props.layer.params[def.key]"
        :label="def.label"
        :min="def.min"
        :max="def.max"
        :step="def.step"
        :hint="def.hint"
        :format="value => formatValue(def, value)"
        @update:model-value="value => editor.updateParam(props.layer.id, def.key, value)"
      />
    </section>
    <UButton
      icon="i-lucide-rotate-ccw"
      label="重置全部参数"
      color="neutral"
      variant="ghost"
      size="sm"
      block
      @click="editor.resetParams(props.layer.id)"
    />
  </div>
</template>
