import axios from 'axios'
import { passportApiBase } from '@/settings'
import { http } from './client'
import type { AuthData, DataResponse } from './types'

/**
 * 管理员登录。
 *
 * 接口：POST /api/v1/passport/auth/login（PassportRoute.php:15）
 * 入参：email + password，password 至少 8 位（AuthLogin.php 的校验规则）
 * 登录**不需要**人机验证 —— Turnstile 只挂在注册接口上（AuthController@register）。
 *
 * 失败是 HTTP 500 + {message}，不是 4xx：
 *   - 邮箱或密码错误 → 'Incorrect email or password'
 *   - 密码错误次数超限 → 'There are too many password errors...'
 *   - 账号被封 → 'Your account has been suspended'
 * 校验失败（邮箱格式/密码太短）才是 422 + errors。
 * 422 由 Login.tsx 逐字段落到表单上，所以带 handle422，拦截器不再重复弹提示。
 */
export async function login(
  email: string,
  password: string,
): Promise<AuthData> {
  const response = await http.post<DataResponse<AuthData>>(
    `${passportApiBase}/auth/login`,
    { email, password },
    { handle422: true },
  )
  return response.data.data
}

/**
 * 用户侧接口基址（不带 secure_path）。管理员 JWT 同样能过 'user' 中间件。
 * 目前只有退出登录用到，所以没放进 settings.ts。
 */
const userApiBase = '/api/v1/user'

/** 撤销会话的超时：退出登录不该让人等，拿不到结果也无所谓 */
const REVOKE_TIMEOUT = 5_000

/**
 * 撤销服务端的这一个登录会话（退出登录时调用，best-effort）。
 *
 * 接口：POST /api/v1/user/removeActiveSession（UserRoute.php:28）
 *   → UserController@removeActiveSession → AuthService::removeSession(session_id)，
 *   把这个 guid 从 USER_SESSIONS:{uid} 白名单里删掉。
 *   session_id 就是 JWT payload 里的 `session`（AuthService::generateAuthData）。
 *
 * 为什么非调不可：白名单用 Cache::put 写入且不带 TTL（Laravel 8 下等于永久），
 * JWT 本身也没有 exp。只删本地凭证的话，已经泄露出去的 token（HAR 文件、截图、
 * 恶意扩展）会一直有效，直到管理员改密码 / 重置触发 removeAllSession。
 *
 * ⚠️ 后端局限：decryptAuthData 把 jwt → user 缓存 3600 秒，命中缓存时不再查白名单，
 * 而 removeSession 没有像 removeAllSession 那样 Cache::forget(auth_data)。
 * 所以撤销最多要 1 小时才真正生效；要立即失效只能改后端。
 * 另外 'user' 中间件会校验账号 site_id 与当前站点一致（Admin 中间件不校验），
 * 不一致时这里拿到 403，同样忽略。
 *
 * 刻意用裸 axios 而不是 http 实例：
 *   - Authorization 必须显式传入。http 的请求拦截器在请求真正发出时才读 localStorage，
 *     而 signOut 紧接着就 clearSession()，走 http 会变成不带凭证的请求 → 静默 403。
 *   - 不要拦截器的副作用：凭证已失效时的 403 会触发硬跳转，断网 / 超时会弹提示，
 *     退出登录不该因为撤销失败打扰用户。
 */
export async function revokeSession(
  authData: string,
  sessionId: string,
): Promise<void> {
  await axios.post(
    `${userApiBase}/removeActiveSession`,
    { session_id: sessionId },
    {
      timeout: REVOKE_TIMEOUT,
      // 裸 JWT，无 Bearer 前缀（见 client.ts 文件头）
      headers: { Accept: 'application/json', Authorization: authData },
    },
  )
}
