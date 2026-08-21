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
 */
export async function login(
  email: string,
  password: string,
): Promise<AuthData> {
  const response = await http.post<DataResponse<AuthData>>(
    `${passportApiBase}/auth/login`,
    { email, password },
  )
  return response.data.data
}
