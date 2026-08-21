import { ADMIN_ENDPOINTS } from './endpoints'
import { call, callList } from './request'
import type { PageQuery } from './types'

/**
 * 统计接口。
 *
 * ⚠️ 路由里注册了 10 个，其中 **3 个是死路由**（StatController 里没有对应方法，
 * 调用必然 500，已实测）：getStat / getRanking / getStatRecord。
 * 本文件只封装可用的 7 个。
 */

/** getOverride 的返回。**所有金额字段单位是分**。 */
export interface StatOverview {
  /** 最近 10 分钟内有上报的用户数（User.t >= now-600） */
  online_user: number
  /** 本月至今收款（分）。口径：created_at 在本月且 status 不在 [0,2] 的订单 total_amount 之和 */
  month_income: number
  month_register_total: number
  day_register_total: number
  /** 待处理工单数（status=0 且 reply_status=0） */
  ticket_pending_total: number
  /** 待确认佣金的订单数 */
  commission_pending_total: number
  day_income: number
  last_month_income: number
  /** 本月已发放佣金（分） */
  commission_month_payout: number
  commission_last_month_payout: number
}

export function fetchStatOverview() {
  return call<StatOverview>(ADMIN_ENDPOINTS.stat.getOverride)
}

/**
 * 近 31 天趋势，已被后端摊平成「每天 × 5 个指标」的长表
 * （type/date/value），可直接喂给图表。
 *
 * ⚠️ 后端已经把金额除以 100 了（收款金额、佣金金额是**元**），
 * 而注册人数/笔数是原值。同一个 value 字段混了两种量纲，
 * 画图时必须按 type 分开，不能放同一个 Y 轴。
 *
 * 数据来源是 v2_stat 表，由 `php artisan v2board:statistics` 定时任务写入 ——
 * **定时任务没跑就一直是空数组**。
 */
export interface StatOrderPoint {
  type: string
  /** 'MM-DD' */
  date: string
  value: number
}

export function fetchStatTrend() {
  return call<StatOrderPoint[]>(ADMIN_ENDPOINTS.stat.getOrder)
}

/** 节点流量排行。total 已被后端换算成 **GB**。 */
export interface ServerRankItem {
  server_id: number
  server_type: string
  u: number
  d: number
  /** GB */
  total: number
  server_name?: string
}

/** 昨日节点排行（前 15） */
export function fetchServerLastRank() {
  return call<ServerRankItem[]>(ADMIN_ENDPOINTS.stat.getServerLastRank)
}

/** 今日节点排行（前 15） */
export function fetchServerTodayRank() {
  return call<ServerRankItem[]>(ADMIN_ENDPOINTS.stat.getServerTodayRank)
}

/**
 * 用户流量排行。total 已按 server_rate 加权并换算成 **GB**，
 * 同一用户跨节点的记录已被后端合并。
 */
export interface UserRankItem {
  user_id: number
  u: number
  d: number
  /** GB，已乘倍率 */
  total: number
  /** 用户已被删除时后端返回字符串 "null" */
  email: string
}

export function fetchUserLastRank() {
  return call<UserRankItem[]>(ADMIN_ENDPOINTS.stat.getUserLastRank)
}

export function fetchUserTodayRank() {
  return call<UserRankItem[]>(ADMIN_ENDPOINTS.stat.getUserTodayRank)
}

/** 单个用户的流量明细记录 */
export interface StatUserRecord {
  id: number
  user_id: number
  server_rate: string
  u: number
  d: number
  record_type: string
  record_at: number
  created_at: number
  updated_at: number
}

/** ⚠️ user_id 必填（后端 required|integer），不传是 422 */
export function fetchUserStatRecords(
  userId: number,
  query: PageQuery = {},
) {
  return callList<StatUserRecord>(ADMIN_ENDPOINTS.stat.getStatUser, {
    ...query,
    user_id: userId,
  } as PageQuery & Record<string, unknown>)
}
