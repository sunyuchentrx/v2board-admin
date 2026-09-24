/**
 * 鉴权凭证的本地存储。
 *
 * 后端 AuthService 的机制：auth_data 是用 app.key 签名的 JWT（payload 只有 {id, session}，
 * 没有 exp），服务端还在 Cache 里存了一份 session 白名单（USER_SESSIONS:{uid}），
 * 且写入时不带 TTL —— 也就是说 token 本身永不过期，只有白名单里的 guid 被删掉才失效。
 *
 * 所以「登出」光丢本地凭证不够：token 若已泄露，服务端会一直认它。退出时要先调
 * removeActiveSession 把这个 guid 从白名单里删掉（见 api/auth.ts 的 revokeSession，
 * 以及后端 1 小时鉴权缓存的局限），再清本地。
 */

const TOKEN_KEY = 'v2board_admin_v2_auth'

export interface StoredSession {
  authData: string
  isAdmin: boolean
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (typeof parsed.authData !== 'string' || !parsed.authData) return null
    return { authData: parsed.authData, isAdmin: parsed.isAdmin === true }
  } catch {
    // 存储被手改坏 / JSON 损坏，当作未登录，不要让整个应用崩在启动阶段
    return null
  }
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * 从 auth_data（JWT）里取出服务端 session guid（AuthService::generateAuthData 写的
 * `session` 字段），removeActiveSession 要用它。
 *
 * 只解码不验签：签名只有后端能验，这里拿到的值只用来告诉后端「撤销哪一个」，
 * 后端撤销时只动当前登录用户自己的白名单，伪造也撤不了别人的。
 * 格式不对（被手改过、将来换了格式）返回 null，调用方跳过撤销即可。
 */
export function sessionIdOf(authData: string): string | null {
  const segment = authData.split('.')[1]
  if (!segment) return null
  try {
    // base64url → base64；atob 按 forgiving-base64 解码，缺省的 '=' 填充不影响
    const payload = JSON.parse(
      atob(segment.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { session?: unknown }
    return typeof payload.session === 'string' && payload.session
      ? payload.session
      : null
  } catch {
    return null
  }
}

/**
 * 订阅**其他标签页**对登录凭证的修改（登录 / 退出 / 被 403 清掉）。
 * storage 事件只在别的标签页触发，本页自己的 save/clear 不会回调。
 * 返回取消订阅函数，直接交给 useEffect 当 cleanup。
 */
export function subscribeSessionChange(listener: () => void): () => void {
  function onStorage(event: StorageEvent) {
    // key 为 null 表示整个 localStorage 被 clear()
    if (event.key === null || event.key === TOKEN_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
