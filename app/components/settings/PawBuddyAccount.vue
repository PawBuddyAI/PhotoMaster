<script setup lang="ts">
import { isDesktop } from '~/lib/desktop'
import { useSettingsStore } from '~/stores/settings'

/**
 * PawBuddy 账户的设置行，放在读图连接配置的分组里，向导与设置页共用。
 * 未连接时推荐登录（网页授权，见 usePawBuddy），网站没有自动跳回时可以粘贴连接码；已连接时显示账户，可以充值或断开。
 */
const settings = useSettingsStore()
const pawbuddy = usePawBuddy()
const notify = useNotify()
const desktop = isDesktop()

const loggingIn = ref(false)
const pasting = ref(false)
const code = ref('')
const connecting = ref(false)

/** 网页版整页跳走，按钮保持加载直到离开；桌面版打开浏览器后展开连接码一行，深链没回来时可以粘贴 */
async function login() {
  loggingIn.value = true
  try {
    await pawbuddy.login()
    if (desktop) {
      pasting.value = true
    }
  } catch (err) {
    notify.error(err)
  } finally {
    if (desktop) {
      loggingIn.value = false
    }
  }
}

async function submitCode() {
  connecting.value = true
  try {
    if (await pawbuddy.connect(code.value)) {
      code.value = ''
      pasting.value = false
    }
  } finally {
    connecting.value = false
  }
}

async function openPurchase() {
  try {
    await pawbuddy.openPurchase()
  } catch (err) {
    notify.error(err)
  }
}
</script>

<template>
  <SettingsRow
    v-if="settings.pawbuddy"
    label="PawBuddy 账户"
    :description="settings.pawbuddy.email ? `已连接 ${settings.pawbuddy.email}` : '已连接'"
  >
    <div class="flex justify-end gap-2">
      <UButton
        icon="i-lucide-wallet"
        label="充值"
        color="neutral"
        variant="outline"
        @click="openPurchase"
      />
      <UButton
        label="断开"
        color="neutral"
        variant="outline"
        @click="pawbuddy.disconnect()"
      />
    </div>
  </SettingsRow>
  <template v-else>
    <SettingsRow
      label="PawBuddy 账户"
      badge="推荐"
      description="登录后自动填好接口与模型，读图和修图按量从账户余额扣费"
    >
      <div class="flex justify-end gap-2">
        <UButton
          v-if="!pasting"
          label="粘贴连接码"
          color="neutral"
          variant="ghost"
          @click="pasting = true"
        />
        <UButton
          icon="i-lucide-log-in"
          label="登录 PawBuddy"
          :loading="loggingIn"
          @click="login"
        />
      </div>
    </SettingsRow>
    <Transition name="reveal">
      <SettingsRow
        v-if="pasting"
        label="连接码"
        description="网站没有自动跳回时，复制网站上的连接码粘贴到这里"
      >
        <!-- 回车提交这一行，不冒泡到向导弹窗，否则会被当成「继续」 -->
        <form
          class="flex gap-2"
          @submit.prevent="submitCode"
        >
          <UInput
            v-model="code"
            placeholder="PB1.…"
            autocomplete="off"
            aria-label="连接码"
            class="min-w-0 flex-1"
            :ui="{ base: 'font-mono' }"
            @keydown.enter.stop
          />
          <UButton
            type="submit"
            label="连接"
            color="neutral"
            variant="outline"
            :loading="connecting"
            :disabled="!code.trim()"
          />
        </form>
      </SettingsRow>
    </Transition>
  </template>
</template>
