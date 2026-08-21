import { ADMIN_ENDPOINTS } from './endpoints'
import { call, callList } from './request'
import type { PageQuery } from './types'

/* ================================================================== *
 * 工单
 * ================================================================== */

/** 工单状态：0 开启中 / 1 已关闭（close 接口就是把 status 置 1） */
export const TICKET_STATUS = { 0: '开启中', 1: '已关闭' } as const

/** 回复状态：0 待客服回复 / 1 已回复（用户待查看） */
export const TICKET_REPLY_STATUS = { 0: '待回复', 1: '已回复' } as const

/** 工单级别 */
export const TICKET_LEVELS = { 0: '低', 1: '中', 2: '高' } as const

export interface AdminTicket {
  id: number
  user_id: number
  subject: string
  level: number
  status: number
  reply_status: number
  created_at: number
  updated_at: number
}

export interface TicketMessage {
  id: number
  user_id: number
  ticket_id: number
  message: string
  /** 后端计算：发信人不是工单创建者即为客服/管理员 */
  is_me: boolean
  created_at: number
  updated_at: number
}

export type TicketDetail = AdminTicket & { message: TicketMessage[] }

/**
 * 工单列表。
 *
 * ⚠️ 固定按 updated_at 倒序，**忽略 sort 参数**（TicketController::fetch）。
 * 过滤参数不是通用的 filter[] 三元组，而是三个专用参数：
 *   status（精确值）、reply_status（**数组**，走 whereIn）、email（精确匹配邮箱）
 * 注意 email 这里是精确 `where('email', $value)`，不是模糊 —— 和订单那个
 * 写坏了的模糊过滤不同，这个能正常用，但必须填完整邮箱。
 */
export interface TicketListQuery extends PageQuery {
  status?: 0 | 1
  /** 数组，后端用 whereIn */
  reply_status?: number[]
  /** 完整邮箱，精确匹配 */
  email?: string
}

export function fetchTickets(query: TicketListQuery) {
  return callList<AdminTicket>(ADMIN_ENDPOINTS.ticket.fetch, query)
}

/** 同一个接口带 id 就返回单条 + 全部消息 */
export function fetchTicketDetail(id: number) {
  return call<TicketDetail>(ADMIN_ENDPOINTS.ticket.fetch, { id })
}

/** 以管理员身份回复。会把 reply_status 置 1 并发通知（TicketService::replyByAdmin） */
export function replyTicket(id: number, message: string) {
  return call<boolean>(ADMIN_ENDPOINTS.ticket.reply, { id, message })
}

/** 关闭工单（status 置 1）。关闭后不可再回复。 */
export function closeTicket(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.ticket.close, { id })
}

/* ================================================================== *
 * 支付网关
 * ================================================================== */

export interface AdminPayment {
  id: number
  uuid: string
  payment: string
  name: string
  icon: string | null
  config: Record<string, unknown> | string
  notify_domain: string | null
  handling_fee_fixed: number | null
  handling_fee_percent: number | null
  enable: number
  sort: number | null
  created_at: number
  updated_at: number
  /** 后端 fetch 附加：完整的回调地址（含 notify_domain 覆盖后的结果） */
  notify_url?: string
}

/** 不分页，按 sort 升序 */
export function fetchPayments() {
  return call<AdminPayment[]>(ADMIN_ENDPOINTS.payment.fetch)
}

/** 可用的网关类名列表（扫 app/Payments/*.php 得来） */
export function fetchPaymentMethods() {
  return call<string[]>(ADMIN_ENDPOINTS.payment.getPaymentMethods)
}

/** 某网关的配置表单定义（各 Payment 类的 form() 返回） */
export interface PaymentFormField {
  label: string
  description?: string
  type: string
  /** 已保存的值（PaymentService::form 会回填） */
  value?: unknown
}

export function fetchPaymentForm(payment: string, id?: number) {
  return call<Record<string, PaymentFormField>>(
    ADMIN_ENDPOINTS.payment.getPaymentForm,
    { payment, ...(id ? { id } : {}) },
  )
}

export interface PaymentSavePayload {
  id?: number
  name: string
  payment: string
  /** 各网关自己的配置键值 */
  config: Record<string, unknown>
  icon?: string | null
  /** 必须是合法 URL（nullable|url） */
  notify_domain?: string | null
  /** 分 */
  handling_fee_fixed?: number | null
  /** 0.1 - 100 之间（后端 between:0.1,100） */
  handling_fee_percent?: number | null
}

/**
 * 新增/编辑支付方式。
 * ⚠️ 后端第一件事就是检查 config('v2board.app_url')，没配站点地址会直接
 * abort(500,'请在站点配置中配置站点地址') —— 因为回调地址要靠它拼。
 */
export function savePayment(payload: PaymentSavePayload) {
  return call<boolean>(ADMIN_ENDPOINTS.payment.save, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/** 切换启用（取反，不接受目标值） */
export function togglePaymentEnable(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.payment.show, { id })
}

export function dropPayment(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.payment.drop, { id })
}

/** 传全量顺序，参数名是 ids（不是 payment_ids） */
export function sortPayments(ids: number[]) {
  return call<boolean>(ADMIN_ENDPOINTS.payment.sort, { ids })
}

/* ================================================================== *
 * 前台主题
 * ================================================================== */

export interface ThemeConfigItem {
  field_name: string
  label?: string
  field_type?: string
  default_value?: unknown
  select_options?: Record<string, string> | string[]
}

export interface ThemeDefinition {
  name?: string
  description?: string
  version?: string
  images?: string
  configs: ThemeConfigItem[]
}

/**
 * 全部主题的定义（读各主题目录下的 config.json）。
 *
 * ⚠️ 返回的**不是**「主题名 → 定义」的字典，而是包了一层：
 *     { themes: { 主题名: 定义 }, active: 当前启用的主题名 }
 * （ThemeController::getThemes 的 response 里显式写了这两个键。）
 * 只有 config.json 里含 configs 数组的主题才会出现在 themes 里。
 */
export interface ThemesResponse {
  themes: Record<string, ThemeDefinition>
  active: string
}

export function fetchThemes() {
  return call<ThemesResponse>(ADMIN_ENDPOINTS.theme.getThemes)
}

/** 某主题当前生效的配置值（读 config/theme/{name}.php） */
export function fetchThemeConfig(name: string) {
  return call<Record<string, unknown> | null>(
    ADMIN_ENDPOINTS.theme.getThemeConfig,
    { name },
  )
}

/**
 * 保存主题配置。
 *
 * ⚠️ `config` 参数要求是 **base64(JSON)**，不是普通对象
 * （ThemeController::saveThemeConfig 里 base64_decode → json_decode）。
 *
 * ⚠️ 和系统配置一样，这里也调 Artisan::call('config:cache')，
 * 在 Workerman 下同样会抛 PHP_SELF 异常 → 主题配置文件写进去了但不生效，
 * 需要人工 config:cache + 重启。差别是这里 Artisan 调用**包在 try/catch 里**，
 * 所以返回的是 abort(500,'保存失败')。
 */
export function saveThemeConfig(name: string, config: Record<string, unknown>) {
  const encoded = btoa(
    // 主题配置可能含中文，直接 btoa 会抛 InvalidCharacterError
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify(config))),
  )
  return call<Record<string, unknown>>(ADMIN_ENDPOINTS.theme.saveThemeConfig, {
    name,
    config: encoded,
  })
}

/* ================================================================== *
 * 系统状态
 * ================================================================== */

export interface SystemStatus {
  /** 计划任务最近 2 分钟内是否跑过 */
  schedule: boolean
  /** Horizon 是否在运行且未暂停 */
  horizon: boolean
  /** 计划任务最后一次执行的 unix 秒；从未跑过则为 null */
  schedule_last_runtime: number | null
}

export function fetchSystemStatus() {
  return call<SystemStatus>(ADMIN_ENDPOINTS.system.getSystemStatus)
}

export interface QueueStats {
  failedJobs: number
  jobsPerMinute: number
  pausedMasters: number
  processes: number
  recentJobs: number
  status: boolean
  queueWithMaxRuntime: string | null
  queueWithMaxThroughput: string | null
  periods: { failedJobs: number; recentJobs: number }
  wait: Record<string, number>
}

export function fetchQueueStats() {
  return call<QueueStats>(ADMIN_ENDPOINTS.system.getQueueStats)
}

export interface QueueWorkloadItem {
  name: string
  length: number
  wait: number
  processes: number
  split_queues?: unknown
}

export function fetchQueueWorkload() {
  return call<QueueWorkloadItem[]>(ADMIN_ENDPOINTS.system.getQueueWorkload)
}

export interface SystemLogItem {
  id: number
  title: string | null
  level: string
  host: string | null
  uri: string | null
  method: string | null
  data: string | null
  ip: string | null
  created_at: number
  updated_at: number
}

/**
 * 系统日志。
 * ⚠️ 分页参数是 `page_size`（下划线），**不是 pageSize** ——
 * SystemController::getSystemLog 读的是 $request->input('page_size')。
 * 这是整个后台里唯一一个用下划线命名分页大小的接口。
 */
export function fetchSystemLog(query: {
  current?: number
  page_size?: number
  level?: string
}) {
  return callList<SystemLogItem>(ADMIN_ENDPOINTS.system.getSystemLog, query)
}
