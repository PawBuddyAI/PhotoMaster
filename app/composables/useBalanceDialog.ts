/** 全局只显示一个余额弹框，多次请求失败不会叠加。 */
export function useBalanceDialog() {
  return useState<boolean>('insufficient-balance-dialog', () => false)
}
