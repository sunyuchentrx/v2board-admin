/**
 * 鉴权凭证的本地存储。
 *
 * 后端 AuthService 的机制：auth_data 是用 app.key 签名的 JWT，服务端还在 Cache 里
 * 存了一份 session 白名单（USER_SESSIONS:{uid}）。所以「登出」只需丢掉本地凭证，
 * 服务端那份由后台的 resetSecret / 封禁等操作清理，前端管不了也不该管。
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
