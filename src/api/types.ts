/**
 * 后端响应契约。全部逆推自后端源码，不是猜的：
 *   - 列表：app/Http/Controllers/V1/Admin/UserController.php@fetch → {data, total}
 *   - 操作：同文件 @ban → {data: true}
 *   - 错误：app/Exceptions/Handler.php::convertExceptionToArray → {message}
 *           debug 模式下额外带 exception/file/line/trace
 *   - 校验错误：Laravel 标准 422 → {message, errors:{字段:[msg]}}
 */

/** 列表接口响应（注意：后端不返回 antd Pro 期望的 success 字段，需在适配层补） */
export interface ListResponse<T> {
  data: T[]
  total: number
}

/** 单值 / 操作接口响应 */
export interface DataResponse<T> {
  data: T
}

/** 错误响应体 */
export interface ErrorBody {
  message: string
  /** 仅 422 校验失败时存在 */
  errors?: Record<string, string[]>
  /** 仅 APP_DEBUG=true 时存在，生产环境没有，不要依赖 */
  exception?: string
  file?: string
  line?: number
}

/**
 * 列表接口的分页/排序参数。
 * 参数名是 antd Pro 的原生约定（后端本来就是照 antd Pro 写的）：
 *   current / pageSize / sort / sort_type
 * 见 UserController.php@fetch。
 */
export interface PageQuery {
  current?: number
  /** 后端会把小于 10 的值强制改成 10（UserController.php@fetch），前端别给更小的选项 */
  pageSize?: number
  sort?: string
  sort_type?: 'ASC' | 'DESC'
}

/** 登录接口返回体（AuthService::generateAuthData） */
export interface AuthData {
  /** 用户订阅 token，不是鉴权凭证 */
  token: string
  /** 0/1，非管理员登录后台要拒绝 */
  is_admin: number
  /** 真正的鉴权凭证：裸 JWT，放 Authorization 头，不加 Bearer 前缀 */
  auth_data: string
}
