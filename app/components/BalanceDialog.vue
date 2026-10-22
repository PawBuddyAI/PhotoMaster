<script setup lang="ts">
import { openExternal } from '~/lib/desktop'
import { purchaseUrl } from '~/lib/pawbuddy'
import { fetchPawBuddyBalance } from '~/lib/pawbuddyBalance'
import { useSettingsStore } from '~/stores/settings'

const open = useBalanceDialog()
const settings = useSettingsStore()
const balance = ref<number | null>(null)
const loading = ref(false)
const balanceError = ref('')
const purchaseError = ref('')
let controller: AbortController | null = null

const formattedBalance = computed(() => balance.value === null
  ? '—'
  : new Intl.NumberFormat('zh-CN', {
      style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 6
    }).format(balance.value))

async function refreshBalance() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  balance.value = null
  balanceError.value = ''
  loading.value = false
  if (!open.value || !settings.pawbuddy) return
  loading.value = true
  try {
    const value = await fetchPawBuddyBalance(settings.visionConnection, request.signal)
    if (controller === request && !request.signal.aborted) balance.value = value
  } catch {
    if (controller === request && !request.signal.aborted) {
      balanceError.value = '暂时无法查询余额，请稍后刷新。你仍可以前往 PawBuddy 充值。'
    }
  } finally {
    if (controller === request) loading.value = false
  }
}

watch(() => [open.value, settings.pawbuddy, settings.vision.baseURL, settings.vision.apiKey], () => {
  purchaseError.value = ''
  void refreshBalance()
}, { immediate: true })
onBeforeUnmount(() => controller?.abort())

async function purchase() {
  if (!settings.pawbuddy) return
  purchaseError.value = ''
  try {
    await openExternal(purchaseUrl(settings.pawbuddy.site))
  } catch {
    purchaseError.value = '无法打开充值页面，请到 PawBuddy 网站充值。'
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="账户余额不足"
    :description="settings.pawbuddy
      ? 'PawBuddy 返回余额不足，本次 AI 请求未完成。充值后请返回这里重试。'
      : '当前 AI 服务返回余额不足，请前往该服务的账户页面充值后重试。'"
  >
    <template #body>
      <div
        v-if="settings.pawbuddy"
        class="space-y-4"
      >
        <p
          v-if="settings.pawbuddy.email"
          class="text-sm break-all text-muted"
        >
          {{ settings.pawbuddy.email }}
        </p>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p
            class="text-sm"
            role="status"
          >
            当前余额：<span class="font-medium tabular-nums text-highlighted">{{ loading ? '查询中…' : formattedBalance }}</span>
          </p>
          <UButton
            label="刷新余额"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="loading"
            @click="refreshBalance"
          />
        </div>
        <p
          v-if="balanceError"
          role="alert"
          class="text-sm text-warning"
        >
          {{ balanceError }}
        </p>
        <p
          v-else-if="balance !== null && balance > 0"
          class="text-sm text-muted"
        >
          已查到可用余额。若刚完成充值，请关闭弹框后重试；若仍提示不足，请在 PawBuddy 网站查看用量与额度。
        </p>
        <p
          v-if="purchaseError"
          role="alert"
          class="text-sm text-warning"
        >
          {{ purchaseError }}
        </p>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        充值后可重新发起 AI 请求，已完成的照片编辑会保留。
      </p>
    </template>
    <template #footer>
      <DialogActions
        v-if="settings.pawbuddy"
        confirm-label="去充值"
        confirm-icon="i-lucide-external-link"
        cancel-label="稍后再说"
        @confirm="purchase"
        @cancel="open = false"
      />
      <DialogActions
        v-else
        confirm-label="知道了"
        hide-cancel
        @confirm="open = false"
      />
    </template>
  </UModal>
</template>
