import { describe, expect, it, vi } from 'vitest'
import { fetchPawBuddyBalance } from '~/lib/pawbuddyBalance'

const connection = { baseURL: 'https://gateway.example/v1/', apiKey: ' sk-test ' }

describe('PawBuddy 余额查询', () => {
  it.each([{ balance: 0 }, { balance: -0.02 }, { balance: 1.25 }, { remaining: 3 }])('读取有效余额 %j', async (body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))
    expect(await fetchPawBuddyBalance(connection, undefined, fetchImpl)).toBe(body.balance ?? body.remaining)
    expect(fetchImpl).toHaveBeenCalledWith('https://gateway.example/v1/usage', expect.objectContaining({
      headers: { Authorization: 'Bearer sk-test' }, credentials: 'omit', signal: expect.any(AbortSignal)
    }))
  })

  it.each([{}, { balance: null }, { balance: '0' }, { balance: true }])('无效响应不能当成零余额 %j', async (body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))
    await expect(fetchPawBuddyBalance(connection, undefined, fetchImpl)).rejects.toThrow('有效余额')
  })

  it('查询失败不泄露响应中的凭据或误报零余额', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret', { status: 401 }))
    await expect(fetchPawBuddyBalance(connection, undefined, fetchImpl)).rejects.toThrow('暂时无法查询余额')
  })
})
