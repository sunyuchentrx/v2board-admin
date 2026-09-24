import { adminApiBase } from '@/settings'
import { LONG_TIMEOUT, http } from './client'
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
 * ⚠️ 这个接口对**两个字段**是「缺省即清空」语义：
 *   - 不传 plan_id → 后端把 group_id 置 null（UserController.php:152）
 *   - 不传 invite_user_email → 后端把 invite_user_id 置 null（:160）
 * 所以这两个字段在类型上是必填的，每次保存都必须按当前值带上。
 *
 * 其余可选字段（流量/余额/佣金/到期时间/限速等）在 UserUpdate.php 里都不是 required，
 * validated() 只包含请求里出现的键，`$user->update($params)` 也只写这些键 ——
 * **不传就不改**。编辑表单应该只提交管理员改过的字段：否则打开弹窗之后发生的
 * 流量上报（TrafficUpdate 每分钟累加 u/d）、余额下单、续费、佣金到账都会被
 * 表单里的旧值整体覆盖回去；流量还要经过 GB 换算，原样提交也会有精度损失。
 *
 * email / banned / is_admin / is_staff 在 UserUpdate.php 里是 required。
 */
export interface UserUpdatePayload {
  id: number
  email: string
  /** 留空表示不改密码；后端 min:8 */
  password?: string
  transfer_enable?: number // 字节
  device_limit?: number | null
  expired_at?: number | null // unix 秒；null = 长期有效
  banned: 0 | 1
  /** 必须每次都带：缺省会清空 group_id */
  plan_id: number | null
  commission_rate?: number | null // 0-100
  discount?: number | null // 0-100
  is_admin: 0 | 1
  is_staff: 0 | 1
  u?: number // 字节
  d?: number // 字节
  balance?: number // 分
  commission_type?: number
  commission_balance?: number // 分
  remarks?: string | null
  speed_limit?: number | null
  /**
   * 不在 UserUpdate 校验规则里，后端单独用 $request->input() 读。
   * 必须每次都带：空值会解除邀请关系；填了查不到的邮箱则保持原邀请人不变。
   */
  invite_user_email: string | null
}

/**
 * 调用方（UserEditModal）自己把 422 逐字段落到表单上，所以传 handle422，
 * 拦截器不再重复弹全局提示。
 */
export function updateUser(payload: UserUpdatePayload) {
  return call<boolean>(
    ADMIN_ENDPOINTS.user.update,
    { ...payload } as unknown as Record<string, unknown>,
    { handle422: true },
  )
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

/*
 * 超时：这几个接口在后端逐个用户处理（ban/allDel 对每个用户 removeAllSession，
 * sendMail 用 cursor 逐个 dispatch 队列任务），用户量大时远超默认的 30 秒。
 * 后端跑在 Workerman 常驻进程里，前端超时断开后它照样执行完 —— 前端若按 30 秒
 * 报失败，管理员重试就会重复群发。所以统一用 LONG_TIMEOUT；真超时了由调用方
 * 按「结果未知」处理（禁止原地重试），见 BulkActionModal。
 */

/** 封禁过滤结果命中的所有用户，并踢掉其全部登录会话。 */
export function banUsersByFilter(payload: FilterScopedPayload) {
  return call<boolean>(
    ADMIN_ENDPOINTS.user.ban,
    { ...payload } as unknown as Record<string, unknown>,
    { timeout: LONG_TIMEOUT },
  )
}

/** 删除过滤结果命中的所有用户（不可恢复）。 */
export function deleteUsersByFilter(payload: FilterScopedPayload) {
  return call<boolean>(
    ADMIN_ENDPOINTS.user.allDel,
    { ...payload } as unknown as Record<string, unknown>,
    { timeout: LONG_TIMEOUT },
  )
}

/** 给过滤结果命中的所有用户群发邮件（走 send_email_mass 队列）。 */
export function sendMailByFilter(
  payload: FilterScopedPayload & { subject: string; content: string },
) {
  return call<boolean>(
    ADMIN_ENDPOINTS.user.sendMail,
    { ...payload } as unknown as Record<string, unknown>,
    { timeout: LONG_TIMEOUT },
  )
}

/* ------------------------------------------------------------------ *
 * 「结果未知」记录：超时后跨弹窗、跨刷新地拦住重复提交
 * ------------------------------------------------------------------ */

/**
 * 长耗时接口超时后，后端多半还在跑或已经跑完（Workerman 常驻进程不会因为前端断开而中止）。
 * 只在当次弹窗里锁住确认按钮不够：关掉再打开，组件状态就重置了。
 *
 * 大多数操作「关窗 → 刷新列表」就能看出结果，重试也基本幂等（再封一次、已删的不会再命中）。
 * 但有两类刷新列表根本看不出上次有没有执行，重复提交的代价又很实在：
 *   - 群发邮件：任务进的是 send_email_mass 队列，用户列表里没有任何痕迹；重发 = 人人两封，
 *     还可能让 SMTP 账号被判垃圾发送；
 *   - 批量生成：邮箱是后端随机生成的，重试不会撞唯一约束，而是再多出一整批带套餐的账号。
 * 所以这两类超时时记一条记录，在有效期内再打开时由弹窗展示上次的情况，
 * 要求管理员勾选「已核实」才能提交；同一种操作成功一次就清掉。
 *
 * 用 localStorage 而不是 sessionStorage：管理员「刷新确认」时很可能新开一个标签页，
 * sessionStorage 在新标签页里是空的。存储不可用（隐私模式等）时退回内存，至少当前页面内有效。
 * 这里不存明文密码 —— 批量生成的密码只放内存（见 UserGenerateModal）。
 */
export type UnknownOutcomeKind = 'user.sendMail' | 'user.generateBatch'

export interface UnknownOutcomeRecord<T> {
  /** 超时发生的时间（毫秒时间戳） */
  at: number
  detail: T
}

type UnknownOutcomeStore = Partial<
  Record<UnknownOutcomeKind, UnknownOutcomeRecord<unknown>>
>

const UNKNOWN_OUTCOME_KEY = 'v2board_admin_v2_unknown_outcome'
/**
 * 有效期。超时本身已经等了 LONG_TIMEOUT（10 分钟），之后后端可能还在跑，
 * 群发入队后队列还要慢慢发；过了有效期就当管理员早已核实过，不再打扰。
 */
const UNKNOWN_OUTCOME_TTL = 30 * 60_000

let memoryOutcomes: UnknownOutcomeStore = {}

function readOutcomes(): UnknownOutcomeStore {
  try {
    const raw = localStorage.getItem(UNKNOWN_OUTCOME_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as UnknownOutcomeStore) : {}
  } catch {
    // 存储不可用或被手改坏：退回内存
    return memoryOutcomes
  }
}

function writeOutcomes(store: UnknownOutcomeStore): void {
  memoryOutcomes = store
  try {
    if (Object.keys(store).length === 0) localStorage.removeItem(UNKNOWN_OUTCOME_KEY)
    else localStorage.setItem(UNKNOWN_OUTCOME_KEY, JSON.stringify(store))
  } catch {
    // 忽略：只在当前页面内有效
  }
}

/** 记下一次「结果未知」。同一种操作只留最近一次。返回记录的 at，调用方可以拿它关联只放内存的信息 */
export function rememberUnknownOutcome<T>(kind: UnknownOutcomeKind, detail: T): number {
  const at = Date.now()
  writeOutcomes({ ...readOutcomes(), [kind]: { at, detail } })
  return at
}

/** 有效期内最近一次「结果未知」的记录；没有或已过期返回 null */
export function recentUnknownOutcome<T>(
  kind: UnknownOutcomeKind,
): UnknownOutcomeRecord<T> | null {
  const record = readOutcomes()[kind]
  // 存储被手改坏时当作没有记录，别让弹窗渲染时崩掉
  if (!record || typeof record.at !== 'number' || typeof record.detail !== 'object' || !record.detail) {
    return null
  }
  if (Date.now() - record.at > UNKNOWN_OUTCOME_TTL) {
    clearUnknownOutcome(kind)
    return null
  }
  return record as UnknownOutcomeRecord<T>
}

/** 同一种操作成功一次后调用：管理员已经核实过上一次并有意再执行，之后不必再拦 */
export function clearUnknownOutcome(kind: UnknownOutcomeKind): void {
  const store = readOutcomes()
  if (!(kind in store)) return
  const rest = { ...store }
  delete rest[kind]
  writeOutcomes(rest)
}

/* ------------------------------------------------------------------ *
 * 返回纯文本（非 JSON）的两个接口
 * ------------------------------------------------------------------ */

/**
 * 纯文本接口专用的 transformResponse：成功时原样返回文本，失败时把 JSON 错误体解析回对象。
 *
 * 为什么不能写成 identity `(d) => d`：axios 1.x 在请求失败时**同样**会对
 * error.response.data 跑 transformResponse（dispatchRequest.js 的 onAdapterRejection），
 * 再加上 responseType:'text'，错误体就成了一段 JSON 字符串 —— client.ts 拦截器
 * 取不到 message / errors，只能显示「请求失败 (HTTP 500)」，后端
 * abort(500, '订阅计划不存在') 这类业务文案全丢，422 的逐字段错误也拿不到。
 * 也不能干脆删掉 transformResponse：responseType 为 text 时 axios 默认实现同样不解析 JSON。
 *
 * 按状态码而不是 content-type 判断：成功的 CSV 是 echo 出来的，content-type 不可靠；
 * 失败时解析不了（比如反代返回的 HTML 错误页）就保持原样，交给拦截器兜底文案。
 */
function textBodyOrParsedError(
  data: unknown,
  _headers: unknown,
  status?: number,
): unknown {
  if (typeof data !== 'string') return data
  if (status === undefined || (status >= 200 && status < 300)) return data
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

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
    {
      responseType: 'text',
      transformResponse: [textBodyOrParsedError],
      // 全量导出要把命中的用户一次查完再拼 CSV，大库会超过默认 30 秒
      timeout: LONG_TIMEOUT,
    },
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
  /**
   * 后端不填时密码默认**等于邮箱**（UserController.php:231/267），是弱凭证，
   * 所以 UserGenerateModal 把它设为必填并默认随机生成。
   * 批量模式下整批账号共用这一个密码（后端只接受一个 password）。
   */
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
 *
 * ⚠️ 超时：后端逐个 password_hash（bcrypt，50-250ms/个），500 个要几十秒到两分钟，
 * 而且先 insert + commit 再 echo CSV。前端按 30 秒断开的话，账号照样入库、CSV 丢失，
 * 管理员一重试就再生成一整批。所以用 LONG_TIMEOUT。
 */
export async function generateUsersBatch(
  payload: Omit<UserGeneratePayload, 'email_prefix'> & {
    generate_count: number
  },
): Promise<string> {
  const response = await http.post<string>(
    `${adminApiBase}${ADMIN_ENDPOINTS.user.generate.path}`,
    payload,
    {
      responseType: 'text',
      transformResponse: [textBodyOrParsedError],
      timeout: LONG_TIMEOUT,
    },
  )
  return response.data
}
