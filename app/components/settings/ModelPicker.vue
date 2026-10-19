<script setup lang="ts">
import type { InputMenuItem } from '@nuxt/ui'
import type { ConnectionConfig } from '~/lib/llm/client'
import { filterModels, partitionModels } from '~/lib/llm/models'
import { useModelListStore } from '~/stores/models'

/**
 * 模型名称输入框：可以直接输入，也可以从服务的模型列表（/models）中选择。
 * 首次展开时自动获取列表，右侧按钮重新获取；列表按连接配置缓存在内存中。
 */
const props = withDefaults(defineProps<{
  connection: ConnectionConfig
  /** 排在最前并单独成组的模型，例如修图只用得上图像模型 */
  preferred?: { label: string, pattern: RegExp }
}>(), {
  preferred: undefined
})

const model = defineModel<string>({ required: true })

const modelList = useModelListStore()
const notify = useNotify()
const appConfig = useAppConfig()
const menu = useTemplateRef('menu')
const open = ref(false)
/** 本次展开后输入的关键字；刚展开时为空，先显示完整列表 */
const query = ref('')

const entry = computed(() => modelList.entryFor(props.connection))
const hasKey = computed(() => !!props.connection.apiKey.trim())

const items = computed<InputMenuItem[][]>(() => {
  const matched = filterModels(entry.value.models, query.value)
  if (!matched.length) {
    return []
  }
  if (!props.preferred) {
    return [matched]
  }
  const [preferred, others] = partitionModels(matched, props.preferred.pattern)
  if (!preferred.length || !others.length) {
    return [matched]
  }
  return [
    [{ type: 'label', label: props.preferred.label }, ...preferred],
    [{ type: 'label', label: '其他模型' }, ...others]
  ]
})

const emptyText = computed(() => {
  const { status, models, error } = entry.value
  if (!hasKey.value) {
    return '填写 API Key 后可获取模型列表，也可以直接输入模型名称'
  }
  switch (status) {
    case 'idle':
      return '点击右侧按钮获取模型列表'
    case 'loading':
      return '正在获取模型列表…'
    case 'unsupported':
      return '该服务不提供模型列表接口，请直接输入模型名称'
    case 'error':
      if (!models.length) {
        return `获取模型列表失败：${error?.title}。${error?.description}`
      }
  }
  if (!models.length) {
    return '服务返回的模型列表为空，请直接输入模型名称'
  }
  return `没有包含「${query.value.trim()}」的模型，将直接使用输入的名称`
})

function onOpenChange(value: boolean) {
  open.value = value
  if (!value) {
    return
  }
  query.value = ''
  if (hasKey.value && entry.value.status === 'idle') {
    // 自动获取不弹通知，失败原因显示在下拉列表中
    modelList.load(props.connection).catch(() => {})
  }
}

/** autocomplete 模式下值就是输入框文字，事件类型仍沿用通用的列表项类型 */
function onInput(value: InputMenuItem) {
  const text = typeof value === 'string' ? value : ''
  model.value = text
  if (open.value) {
    query.value = text
  }
}

async function refresh() {
  try {
    const models = await modelList.load(props.connection, { force: true })
    if (models === null) {
      notify.info('该服务不提供模型列表接口', '请直接输入模型名称')
      return
    }
    query.value = ''
    menu.value?.inputRef?.focus()
    open.value = true
  } catch (err) {
    notify.error(err)
  }
}
</script>

<template>
  <UFieldGroup
    size="md"
    class="w-full"
  >
    <UInputMenu
      ref="menu"
      :model-value="model"
      mode="autocomplete"
      :items="items"
      :open="open"
      ignore-filter
      open-on-click
      class="min-w-0 flex-1"
      :ui="{ base: 'font-mono', itemLabel: 'font-mono' }"
      spellcheck="false"
      @update:model-value="onInput"
      @update:open="onOpenChange"
    >
      <!-- autocomplete 模式没有选中指示，与 USelect 一样给当前模型打勾 -->
      <template #item-trailing="{ item, ui }">
        <UIcon
          v-if="item === model"
          :name="appConfig.ui.icons.check"
          :class="ui.itemTrailingIcon()"
        />
      </template>
      <template #empty>
        <span class="text-pretty">{{ emptyText }}</span>
      </template>
    </UInputMenu>
    <UTooltip text="获取模型列表">
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        aria-label="获取模型列表"
        :loading="entry.status === 'loading'"
        :disabled="!hasKey"
        @click="refresh"
      />
    </UTooltip>
  </UFieldGroup>
</template>
