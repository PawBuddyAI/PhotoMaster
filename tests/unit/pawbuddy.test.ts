import { describe, expect, it } from 'vitest'
import {
  authorizeUrl,
  decodeConnectCode,
  DESKTOP_RETURN_URL,
  extractConnectCode,
  purchaseUrl,
  webReturnUrl
} from '~/lib/pawbuddy'

/** 与 PawBuddy 网站 encodeConnectCode 相同的编码：`PB1.` + base64url(JSON) */
function encode(value: unknown): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
    binary += String.fromCharCode(byte)
  }
  return `PB1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

const payload = {
  v: 1,
  gateway: 'https://pawbuddy.example.com/v1',
  api: 'https://pawbuddy.example.com',
  site: 'https://pawbuddy.example.com',
  user: 42,
  email: '我@example.com',
  key: 'sk-测试+/='
}
const connection = { gateway: payload.gateway, site: payload.site, user: 42, email: payload.email, key: payload.key }

describe('连接码', () => {
  it('解析网站生成的连接码，忽略本应用用不到的字段与首尾空白', () => {
    const code = encode(payload)
    expect(code).toMatch(/^PB1\.[\w-]+$/)
    expect(decodeConnectCode(code)).toEqual(connection)
    expect(decodeConnectCode(`  ${code}\n`)).toEqual(connection)
    expect(decodeConnectCode(encode({ ...payload, user: '42', api: undefined }))).toEqual(connection)
  })

  it('格式、版本或字段不对时返回 null', () => {
    expect(decodeConnectCode('')).toBeNull()
    expect(decodeConnectCode('PB2.abc')).toBeNull()
    expect(decodeConnectCode('PB1.@@@')).toBeNull()
    expect(decodeConnectCode('PB1.bm90LWpzb24')).toBeNull()
    const broken = [
      { v: 2 },
      { gateway: '' },
      { gateway: 'javascript:alert(1)' },
      { site: 'not a url' },
      { key: '  ' },
      { key: 1 },
      { email: null },
      { user: 0 },
      { user: 1.5 }
    ]
    for (const patch of broken) {
      expect(decodeConnectCode(encode({ ...payload, ...patch })), JSON.stringify(patch)).toBeNull()
    }
  })

  it('从粘贴的连接码、网站跳回地址与深链里取出连接码', () => {
    const code = encode(payload)
    expect(extractConnectCode(` ${code} `)).toBe(code)
    expect(extractConnectCode(`http://localhost:3000/settings#code=${encodeURIComponent(code)}`)).toBe(code)
    expect(extractConnectCode(`${DESKTOP_RETURN_URL}#code=${code}`)).toBe(code)
    // 网站给 PawBuddy 客户端的深链形式也能直接粘贴
    expect(extractConnectCode(`pawbuddy://connect?code=${encodeURIComponent(code)}`)).toBe(code)
    expect(extractConnectCode('http://localhost:3000/#section')).toBeNull()
    expect(extractConnectCode('http://localhost:3000/#code=abc')).toBeNull()
    expect(extractConnectCode('随便一段文字')).toBeNull()
  })
})

describe('网站地址', () => {
  it('授权页带上应用 id 与编码后的跳回地址', () => {
    const url = new URL(authorizeUrl('https://pawbuddy.example.com/', 'http://localhost:3000/settings'))
    expect(url.origin + url.pathname).toBe('https://pawbuddy.example.com/connect')
    expect(url.searchParams.get('app')).toBe('ai-photo')
    expect(url.searchParams.get('return')).toBe('http://localhost:3000/settings')
    expect(new URL(authorizeUrl('https://pawbuddy.example.com', DESKTOP_RETURN_URL)).searchParams.get('return')).toBe('ai-photo-master://connect')
  })

  it('网页版跳回当前页面，不带查询参数与片段', () => {
    expect(webReturnUrl({ origin: 'http://localhost:3000', pathname: '/settings' })).toBe('http://localhost:3000/settings')
  })

  it('充值页在账户所在的网站', () => {
    expect(purchaseUrl('https://pawbuddy.example.com')).toBe('https://pawbuddy.example.com/purchase')
  })
})
