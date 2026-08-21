import { adminApiBase } from '@/settings'
import { http } from './client'
import { ADMIN_ENDPOINTS } from './endpoints'
import { call, callList } from './request'
import type { DataResponse, PageQuery } from './types'

/* ------------------------------------------------------------------ *
 * 过滤器
 * ------------------------------------------------------------------ */

/**
 * 允许的过滤键。白名单来自 UserFetch.php 的校验规则，多一个都会 422。
 * 注意 `invite_by_email` 不是数据库列：后端会先按邮箱查出用户，再按
 * invite_user_id 过滤（UserController::filter()）。
 */
export const USER_FILTER_KEYS = [
  'id',
  'email',
  'transfer_enable',
  'device_limit',
  'd',
  'expired_at',
  'uuid',
  'token',
  'invite_by_email',
  'invite_user_id',
  'plan_id',
  'banned',
  'remarks',
  'is_admin',
] as const

export type UserFilterKey = (typeof USER_FILTER_KEYS)[number]

/** 允许的比较条件，同样来自 UserFetch.php。'模糊' 会被后端转成 LIKE %value% */
export const USER_FILTER_CONDITIONS = [
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  '模糊',
] as const

export type UserFilterCondition = (typeof USER_FILTER_CONDITIONS)[number]

export interface UserFilter {
  key: UserFilterKey
  condition: UserFilterCondition
  value: string | number
}

/**
 * ⚠️ 单位陷阱：`transfer_enable` 和 `d` 这两个键，后端会把传入值
 * **乘以 1073741824**（当作 GB 处理），而 user/update 提交同名字段时是**字节**。
 * 构造过滤条件时传 GB，不要传字节。
 */
export const GIB_SCALED_FILTER_KEYS: readonly UserFilterKey[] = [
  'transfer_enable',
  'd',
]

/* ------------------------------------------------------------------ *
 * 列表
 * ------------------------------------------------------------------ */

/** user/fetch 返回的行。字段名来自测试机实测的 38 个键。 */
export interface AdminUser {
  id: number
  email: string
  invite_user_id: number | null
  telegram_id: number | null
  balance: number // 分
  discount: number | null // 0-100
  commission_type: number
  commission_rate: number | null // 0-100
  commission_balance: number // 分
  t: number
  u: number // 字节
  d: number // 字节
  transfer_enable: number // 字节
  device_limit: number | null
  banned: number // 0/1
  is_admin: number // 0/1
  is_staff: number // 0/1
  last_login_at: number | null
  last_login_ip: string | null
  uuid: string
  group_id: number | null
  plan_id: number | null
  speed_limit: number | null
  auto_renewal: number
  remind_expire: number
  remind_traffic: number
  token: string
  expired_at: number | null
  remarks: string | null
  created_at: number
  updated_at: number
  // 后端在 fetch 里附加的计算字段
  total_used: number // u + d，字节
  plan_name?: string
  alive_ip: number
  ips: string
  subscribe_url: string
  // 说明：后端 User 模型没有 $hidden，响应里其实还带着
  // password / password_algo / password_salt。这里刻意不声明，
  // 前端一律不读、不存、不展示。
}

export interface UserListQuery extends PageQuery {
  filter?: UserFilter[]
}

export function fetchUsers(query: UserListQuery) {
  return callList<AdminUser>(ADMIN_ENDPOINTS.user.fetch, query)
}

/** 单个用户详情。若有邀请人，会多带一个 invite_user 对象。 */
export function getUserInfoById(id: number) {
  return call<AdminUser & { invite_user?: AdminUser }>(
    ADMIN_ENDPOINTS.user.getUserInfoById,
    { id },
  )
}

/* ------------------------------------------------------------------ *
 * 编辑
 * ------------------------------------------------------------------ */

/**
 * user/update 的提交体。
 *
 * ⚠️ 这个接口是**整体覆盖**语义，不是局部更新：
 *   - 不传 plan_id → 后端把 group_id 置 null（UserController.php:148）
 *   - 不传 invite_user_email → 后端把 invite_user_id 置 null（:156）
 * 所以表单必须把当前完整状态一起提交，漏字段会静默清空数据。
 *
 * email / banned / is_admin / is_staff 在 UserUpdate.php 里是 required。
 */
export interface UserUpdatePayload {
  id: number
  email: string
  /** 留空表示不改密码；后端 min:8 */
  password?: string
  transfer_enable: number // 字节
  device_limit?: number | null
  expired_at?: number | null // unix 秒；null = 长期有效
  banned: 0 | 1
  plan_id?: number | null
  commission_rate?: number | null // 0-100
  discount?: number | null // 0-100
  is_admin: 0 | 1
  is_staff: 0 | 1
  u: number // 字节
  d: number // 字节
  balance: number // 分
  commission_type: number
  commission_balance: number // 分
  remarks?: string | null
  speed_limit?: number | null
  /** 不在 UserUpdate 校验规则里，后端单独用 $request->input() 读 */
  invite_user_email?: string | null
}

export function updateUser(payload: UserUpdatePayload) {
  return call<boolean>(ADMIN_ENDPOINTS.user.update, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/** 重置订阅 token 与 uuid。用户的旧订阅链接会立刻失效。 */
export function resetUserSecret(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.user.resetSecret, { id })
}

/** 删除单个用户（连带其订单、邀请码、工单）。 */
export function deleteUser(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.user.delUser, { id })
}

/**
 * ⚠️ 不要用 /user/setInviteUser —— 那是条**死路由**。
 * AdminRoute.php:118 注册了它，但 UserController 里根本没有 setInviteUser 方法，
 * 调用必然 HTTP 500（已在测试机实测确认）。
 *
 * 设置邀请人请走 updateUser()，传 invite_user_email 字段
 * （UserController.php:150 会按邮箱查出用户并写入 invite_user_id）。
 */

/* ------------------------------------------------------------------ *
 * 按「过滤结果」批量执行的操作 —— 高危，看清注释
 * ------------------------------------------------------------------ */

/**
 * ⚠️⚠️ 下面这几个接口作用于**当前过滤条件命中的全部用户**，
 * 而不是前端勾选的行。后端没有「按 id 批量」的接口。
 *
 * 这意味着 **不传 filter 就是全库操作**：
 *   - ban 不带 filter   → 封禁所有用户
 *   - allDel 不带 filter → 删除所有用户，连同其订单/邀请码/工单
 *
 * 所以这两个函数强制要求显式传 filter 数组（可以是空数组，但必须自己写出来），
 * 让"全库操作"成为一个需要刻意为之的动作，而不是漏参数的默认结果。
 */
export interface FilterScopedPayload {
  /** 传 [] 表示确实要作用于全部用户 */
  filter: UserFilter[]
  sort?: string
  sort_type?: 'ASC' | 'DESC'
}

/** 封禁过滤结果命中的所有用户，并踢掉其全部登录会话。 */
export function banUsersByFilter(payload: FilterScopedPayload) {
  return call<boolean>(ADMIN_ENDPOINTS.user.ban, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/** 删除过滤结果命中的所有用户（不可恢复）。 */
export function deleteUsersByFilter(payload: FilterScopedPayload) {
  return call<boolean>(ADMIN_ENDPOINTS.user.allDel, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/** 给过滤结果命中的所有用户群发邮件（走 send_email_mass 队列）。 */
export function sendMailByFilter(
  payload: FilterScopedPayload & { subject: string; content: string },
) {
  return call<boolean>(ADMIN_ENDPOINTS.user.sendMail, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/* ------------------------------------------------------------------ *
 * 返回纯文本（非 JSON）的两个接口
 * ------------------------------------------------------------------ */

/**
 * 导出 CSV。
 *
 * ⚠️ 这个接口用 `echo` 直接输出 CSV 文本（UserController.php:201），
 * 不是 `{data:...}` 包装，所以不能走 call()。带 UTF-8 BOM。
 * 同样是**按过滤结果**导出，不是按勾选行。
 */
export async function dumpUsersCSV(
  payload: FilterScopedPayload,
): Promise<string> {
  const response = await http.post<string>(
    `${adminApiBase}${ADMIN_ENDPOINTS.user.dumpCSV.path}`,
    payload,
    { responseType: 'text', transformResponse: [(d) => d] },
  )
  return response.data
}

export interface UserGeneratePayload {
  /** 必填（UserGenerate.php 里 required） */
  email_suffix: string
  /** 填了就是单个生成，返回 {data:true} */
  email_prefix?: string
  /** 填了就是批量生成，**返回 CSV 文本**而不是 JSON，最大 500 */
  generate_count?: number
  plan_id?: number | null
  expired_at?: number | null
  /** 不填则密码默认与邮箱相同 */
  password?: string
}

/**
 * 生成单个用户。返回 {data:true}。
 * （同一个后端接口在传 generate_count 时会改成输出 CSV，见下面那个函数。）
 */
export async function generateSingleUser(
  payload: Omit<UserGeneratePayload, 'generate_count'> & {
    email_prefix: string
  },
): Promise<boolean> {
  const response = await http.post<DataResponse<boolean>>(
    `${adminApiBase}${ADMIN_ENDPOINTS.user.generate.path}`,
    payload,
  )
  return response.data.data
}

/**
 * 批量生成用户，返回 CSV 文本（账号,密码,过期时间,UUID,创建时间,订阅地址）。
 *
 * ⚠️ 这是**唯一一次**能拿到明文密码的机会 —— 后端只在这里回显，
 * 之后库里只有 hash。所以必须让用户下载/保存这份 CSV。
 */
export async function generateUsersBatch(
  payload: Omit<UserGeneratePayload, 'email_prefix'> & {
    generate_count: number
  },
): Promise<string> {
  const response = await http.post<string>(
    `${adminApiBase}${ADMIN_ENDPOINTS.user.generate.path}`,
    payload,
    { responseType: 'text', transformResponse: [(d) => d] },
  )
  return response.data
}
