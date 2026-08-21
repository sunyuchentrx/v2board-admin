import axios, { AxiosError, type AxiosInstance } from 'axios'
import { uiBasePath } from '@/settings'
import { clearSession, loadSession } from '@/auth/session'
import { notifyError } from '@/lib/notify'
import { serializeParams } from './serialize'
import type { ErrorBody } from './types'

/**
 * 统一的 HTTP 客户端。
 *
 * ⚠️ 两个必须记住的后端契约：
 *
 * 1. Authorization 头放**裸 JWT，不加 `Bearer ` 前缀**。
 *    app/Http/Middleware/Admin.php 把 header 原值直接喂给 JWT::decode()，
 *    多了 "Bearer " 会解码失败 → 静默 403。这是最容易踩的坑。
 *
 * 2. **HTTP 500 不代表服务器故障**。后端用 abort(500, '提示文案') 返回业务错误，
 *    例如密码错误（AuthController@login）就是 500 + {message:'Incorrect email or password'}。
 *    所以错误提示必须展示 message，不能按状态码笼统显示"服务器错误"。
 *    只有 403 才是「未登录/登录过期」。
 */

/** 规范化后的错误，UI 层只认这个 */
export class ApiError extends Error {
  readonly status: number
  /** 422 校验失败时的逐字段错误 */
  readonly fieldErrors?: Record<string, string[]>

  constructor(
    message: string,
    status: number,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

export const http: AxiosInstance = axios.create({
  // 不设 baseURL：路径由 endpoints.ts 拼好，避免 secure_path 被隐式吞掉
  timeout: 30_000,
  headers: { Accept: 'application/json' },
  // 嵌套参数必须按 PHP 的 a[b][c] 格式序列化，否则列表过滤静默失效（见 serialize.ts）
  paramsSerializer: { serialize: serializeParams },
})

http.interceptors.request.use((config) => {
  const session = loadSession()
  if (session) {
    // 裸 JWT，无 Bearer 前缀（见文件头注释）
    config.headers.Authorization = session.authData
  }
  return config
})

function isOnLoginPage(): boolean {
  return window.location.pathname.startsWith(`${uiBasePath}/login`)
}

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ErrorBody>) => {
    // 网络层失败（断网、超时、CORS），没有 HTTP 响应
    if (!error.response) {
      const text = error.message || '网络请求失败,请检查连接'
      notifyError(text)
      return Promise.reject(new ApiError(text, 0))
    }

    const { status, data } = error.response
    const message =
      (data && typeof data.message === 'string' && data.message) ||
      `请求失败 (HTTP ${status})`

    // 403 = 未登录或登录已过期（Admin.php / User.php 中间件唯一的拒绝码）
    if (status === 403) {
      clearSession()
      if (!isOnLoginPage()) {
        // 硬跳转：凭证已失效，SPA 状态没有保留价值
        window.location.assign(`${uiBasePath}/login`)
      }
    } else if (status !== 422) {
      // 集中弹提示，避免各调用点漏处理导致静默失败。
      // 422 例外：逐字段校验错误应该显示在表单上，弹窗反而碍事。
      notifyError(message)
    }

    return Promise.reject(new ApiError(message, status, data?.errors))
  },
)
