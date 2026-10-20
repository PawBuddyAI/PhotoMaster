<script setup lang="ts">
import { DEFAULT_BASE_URL } from '~/lib/llm/client'

const baseURL = defineModel<string>('baseUrl', { required: true })
const apiKey = defineModel<string>('apiKey', { required: true })

const showKey = ref(false)
</script>

<template>
  <SettingsRow
    label="Base URL"
    description="OpenAI 兼容接口地址，通常以 /v1 结尾"
  >
    <UInput
      v-model="baseURL"
      :placeholder="DEFAULT_BASE_URL"
      class="w-full"
    />
  </SettingsRow>
  <SettingsRow
    label="API Key"
    description="只保存在本机；无需鉴权的服务可填写任意值"
  >
    <UInput
      v-model="apiKey"
      :type="showKey ? 'text' : 'password'"
      placeholder="sk-..."
      autocomplete="off"
      class="w-full"
      :ui="{ base: 'font-mono' }"
    >
      <template #trailing>
        <UButton
          :icon="showKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          color="neutral"
          variant="link"
          size="sm"
          :aria-label="showKey ? '隐藏' : '显示'"
          @click="showKey = !showKey"
        />
      </template>
    </UInput>
  </SettingsRow>
</template>
