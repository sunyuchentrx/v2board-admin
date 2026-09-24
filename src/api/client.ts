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
  /**
   * HTTP 状态码。0 = 没拿到后端的答复（前端超时、断网、网关超时）：
   * 请求可能已经在后端执行完了，调用方不要当成「失败」让用户直接重试。
   */
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

/**
 * 单个请求可带的额外选项（通过 axios 的 config 透传给拦截器）。
 *   handle422 —— 调用方自己把 422 逐字段错误落到表单上，拦截器不要再弹全局提示。
 *                不传时拦截器会把 422 的首条错误弹出来，避免表单静默失败。
 */
declare module 'axios' {
  interface AxiosRequestConfig {
    handle422?: boolean
  }
}

/** 默认超时 */
export const DEFAULT_TIMEOUT = 30_000

/**
 * 长耗时接口（批量生成/封禁/删除/群发、导出 CSV）用的超时。
 * 这些操作在后端可能跑几分钟；30 秒超时会让前端误报失败，诱导管理员重复执行。
 */
export const LONG_TIMEOUT = 10 * 60_000

export const http: AxiosInstance = axios.create({
  // 不设 baseURL：路径由 endpoints.ts 拼好，避免 secure_path 被隐式吞掉
  timeout: DEFAULT_TIMEOUT,
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

/**
 * 没拿到后端答复时的提示。ApiError.status 统一为 0，调用方据此判断「结果未知」。
 *
 * 超时 ≠ 失败：axios 超时只是前端不等了，PHP（Workerman 常驻进程 / php-fpm 在输出前）
 * 并不会因为客户端断开而停下，批量删除、群发邮件、批量生成照样执行到底并提交。
 * 如果提示「失败」，管理员会再点一次 → 重复群发 / 重复建号。
 */
export const TIMEOUT_MESSAGE =
  '请求超时：后端可能仍在执行，请刷新确认结果，切勿重复提交'
const NETWORK_MESSAGE =
  '网络请求失败，请检查连接；如果刚才是提交操作，请先刷新确认结果再重试'
const ABORTED_MESSAGE =
  '请求被浏览器中断：如果刚才是提交操作，请先刷新确认结果再重试'

/**
 * axios xhr 适配器对「浏览器自己取消请求」（刷新 / 跳走页面时 Firefox、Safari 会中断
 * 挂着的 XHR，包括 403 硬跳转那一下）也用 ECONNABORTED，和超时同一个 code，
 * 只能靠它写死的文案区分（adapters/xhr.js 的 onabort）。不按超时报，免得跳页时闪一下
 * 「请求超时」误导人。将来 axios 改了文案，这里认不出来就回落到超时提示 —— 两者都是
 * 「结果未知、先刷新确认」，回落方向是安全的。
 */
const AXIOS_BROWSER_ABORT_TEXT = 'Request aborted'

/**
 * 网关 / CDN 等不到后端时返回的状态码：504（nginx 默认 proxy_read_timeout 60s）、
 * 524（Cloudflare 回源 100s 超时）。生产环境长耗时接口通常先撞上这个，而不是
 * 前端的 LONG_TIMEOUT，所以必须和前端超时同样对待，否则 LONG_TIMEOUT 形同虚设。
 */
const GATEWAY_TIMEOUT_STATUSES = [504, 524]

/**
 * 把错误响应体规范成 ErrorBody。
 *
 * 纯文本接口（导出 CSV、批量生成用户/优惠券/礼品卡）为了拿原始文本，请求里带了
 * responseType:'text' + identity transformResponse。axios 1.x 出错时同样会对
 * error.response.data 跑 transformResponse（dispatchRequest.js 的 onAdapterRejection），
 * 所以这类接口的错误体是**原始 JSON 字符串**：直接取 .message 永远是 undefined，
 * abort(500, '订阅计划不存在') 的文案和 422 的 errors 全丢。这里兜底解析一次；
 * 网关 / CDN 返回的 HTML 错误页解析失败，按「没有后端文案」处理。
 */
function parseErrorBody(data: unknown): Partial<ErrorBody> | undefined {
  let body = data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return undefined
    }
  }
  return body && typeof body === 'object' ? (body as Partial<ErrorBody>) : undefined
}

/** 422 errors 里的第一条文案 */
function firstFieldError(
  errors: Record<string, string[]> | undefined,
): string | undefined {
  for (const list of Object.values(errors ?? {})) {
    const first = Array.isArray(list) ? list[0] : list
    if (typeof first === 'string' && first) return first
  }
  return undefined
}

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // 网络层失败（断网、超时、CORS），没有 HTTP 响应
    if (!error.response) {
      // clarifyTimeoutError 打开时超时的 code 是 ETIMEDOUT，默认是 ECONNABORTED
      const aborted =
        error.code === AxiosError.ECONNABORTED &&
        error.message === AXIOS_BROWSER_ABORT_TEXT
      const timedOut =
        !aborted &&
        (error.code === AxiosError.ECONNABORTED ||
          error.code === AxiosError.ETIMEDOUT)
      const text = aborted
        ? ABORTED_MESSAGE
        : timedOut
          ? TIMEOUT_MESSAGE
          : error.code === AxiosError.ERR_NETWORK
            ? NETWORK_MESSAGE
            : error.message || NETWORK_MESSAGE
      notifyError(text)
      return Promise.reject(new ApiError(text, 0))
    }

    const { status } = error.response
    const body = parseErrorBody(error.response.data)
    const fieldErrors =
      body?.errors && typeof body.errors === 'object' ? body.errors : undefined
    const backendMessage =
      typeof body?.message === 'string' && body.message ? body.message : undefined

    // 网关超时且没有后端文案（是网关自己的错误页）：同前端超时，结果未知
    if (GATEWAY_TIMEOUT_STATUSES.includes(status) && !backendMessage) {
      notifyError(TIMEOUT_MESSAGE)
      return Promise.reject(new ApiError(TIMEOUT_MESSAGE, 0))
    }

    const message =
      // Laravel 8 的 ValidationException message 固定是英文 "The given data was invalid."，
      // 没有信息量；422 优先用第一条字段错误。abort(422, '文案') 不带 errors，回落到 message。
      (status === 422 && firstFieldError(fieldErrors)) ||
      backendMessage ||
      `请求失败 (HTTP ${status})`

    // 403 = 未登录或登录已过期（Admin.php / User.php 中间件唯一的拒绝码）
    if (status === 403) {
      clearSession()
      if (!isOnLoginPage()) {
        // 硬跳转：凭证已失效，SPA 状态没有保留价值
        window.location.assign(`${uiBasePath}/login`)
      }
    } else if (!(status === 422 && error.config?.handle422)) {
      // 集中弹提示，避免各调用点漏处理导致静默失败。422 也弹：
      // 大多数表单的 catch 是空的，不弹就是「点了保存没反应」。
      // 只有显式声明 handle422 的调用方（自己把逐字段错误落到表单上）才跳过。
      notifyError(message)
    }

    return Promise.reject(new ApiError(message, status, fieldErrors))
  },
)
