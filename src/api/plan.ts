import { LONG_TIMEOUT } from './client'
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
  /**
   * 后端 fetch 附加：该套餐当前**有效**用户数（PlanService::countActiveUsers，
   * 只数 expired_at >= now 或为 NULL 的）。已过期但 plan_id 仍指向本套餐的用户不在内，
   * 所以它**不是** force_update 会改写的人数。
   */
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
 * （PlanController::save 的 force_update 分支：
 *  User::withoutGlobalScopes()->where('plan_id', …)->update(…)）。
 *   - **不看到期时间**：已过期的用户也会被改写，人数比 AdminPlan.count 多；
 *   - transfer_enable 是整体覆盖，用户靠流量礼品卡等额外叠加的流量会被抹掉；
 *   - 已用流量 u/d 不动，新流量比已用少的用户会立刻超额。
 * 不传则只改套餐本身，老用户保持原配额。这是个影响面很大的开关，UI 必须写清楚。
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
  return call<boolean>(
    ADMIN_ENDPOINTS.plan.save,
    { ...payload } as unknown as Record<string, unknown>,
    // force_update 是一条覆盖全套餐用户的批量 UPDATE，用户多时可能超过默认 30 秒；
    // 前端先超时会误报失败，诱导管理员重复提交（后端事务其实可能已经提交）
    payload.force_update ? { timeout: LONG_TIMEOUT } : undefined,
  )
}

/**
 * 切换上架/续费状态。
 * ⚠️ 后端只取 show 和 renew（PlanController::update 的 $request->only），
 * 其它字段传了也不生效 —— 改配额要用 savePlan。
 * 这里传的是目标值而不是取反（和 payment/show 不同），重复提交是幂等的。
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
