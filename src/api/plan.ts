import { ADMIN_ENDPOINTS } from './endpoints'
import { call } from './request'

/**
 * 套餐。
 *
 * ⚠️ 单位陷阱：`v2_plan.transfer_enable` 存的是 **GB**（不是字节）。
 * PlanController::save() 里 force_update 分支才乘 1073741824 写进用户表。
 * 各周期价格列是**分**。
 */
export interface AdminPlan {
  id: number
  group_id: number
  name: string
  content: string | null
  /** GB */
  transfer_enable: number
  device_limit: number | null
  speed_limit: number | null
  /** 0=下架 1=上架 */
  show: number
  /** 0=不可续费 1=可续费 */
  renew: number
  sort: number | null
  /** 以下价格单位均为**分**，null 表示该周期不售 */
  month_price: number | null
  quarter_price: number | null
  half_year_price: number | null
  year_price: number | null
  two_year_price: number | null
  three_year_price: number | null
  onetime_price: number | null
  reset_price: number | null
  reset_traffic_method: number | null
  capacity_limit: number | null
  created_at: number
  updated_at: number
  /** 后端 fetch 附加：该套餐当前有效用户数（PlanService::countActiveUsers） */
  count: number
}

/** 流量重置方式。取值白名单来自 PlanSave.php 的 in:0,1,2,3,4 */
export const RESET_TRAFFIC_METHODS = {
  0: '每月 1 号',
  1: '按购买日期',
  2: '不重置',
  3: '每年 1 月 1 号',
  4: '按年重置',
} as const

/** plan/fetch 返回 {data: Plan[]}，不分页、无 total */
export function fetchPlans() {
  return call<AdminPlan[]>(ADMIN_ENDPOINTS.plan.fetch)
}

/**
 * 新增/编辑套餐。带 id 是编辑，不带是新增。
 *
 * ⚠️ `force_update`：编辑时传 1 会把该套餐下**所有用户**的
 * group_id / transfer_enable / device_limit / speed_limit 一起改掉
 * （PlanController.php:44-50）。不传则只改套餐本身，老用户保持原配额。
 * 这是个影响面很大的开关，UI 必须写清楚。
 */
export interface PlanSavePayload {
  id?: number
  name: string
  group_id: number
  /** GB */
  transfer_enable: number
  content?: string | null
  device_limit?: number | null
  speed_limit?: number | null
  /** 各周期价格，单位**分** */
  month_price?: number | null
  quarter_price?: number | null
  half_year_price?: number | null
  year_price?: number | null
  two_year_price?: number | null
  three_year_price?: number | null
  onetime_price?: number | null
  reset_price?: number | null
  reset_traffic_method?: number | null
  capacity_limit?: number | null
  /** 仅编辑时有效：同步覆盖该套餐下所有用户的配额 */
  force_update?: 0 | 1
}

export function savePlan(payload: PlanSavePayload) {
  return call<boolean>(ADMIN_ENDPOINTS.plan.save, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/**
 * 切换上架/续费状态。
 * ⚠️ 后端只取 show 和 renew（PlanController::update 的 $request->only），
 * 其它字段传了也不生效 —— 改配额要用 savePlan。
 */
export function updatePlanFlags(
  id: number,
  flags: { show?: 0 | 1; renew?: 0 | 1 },
) {
  return call<boolean>(ADMIN_ENDPOINTS.plan.update, { id, ...flags })
}

/**
 * 删除套餐。后端会先拦：该套餐下有订单或有用户都不允许删
 * （PlanController::drop）。
 */
export function dropPlan(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.plan.drop, { id })
}

/** 按传入的 id 顺序重排 sort（下标+1）。要传全量顺序，不是只传变动项。 */
export function sortPlans(planIds: number[]) {
  return call<boolean>(ADMIN_ENDPOINTS.plan.sort, { plan_ids: planIds })
}
