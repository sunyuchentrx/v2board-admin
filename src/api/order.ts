import { ADMIN_ENDPOINTS } from './endpoints'
import { call, callList } from './request'
import type { PageQuery } from './types'

/* ------------------------------------------------------------------ *
 * 枚举语义（逐个从后端源码确认，不是猜的）
 * ------------------------------------------------------------------ */

/**
 * 订单状态。取值语义来自 OrderService：
 *   0 待支付 → paid() CAS 迁到 1 → open() 成功后 CAS 迁到 3
 *   2 已取消（cancel() 从 0 迁过来）
 *   4 已折抵（open() 里被新订单抵扣掉的旧订单，OrderService.php:71）
 */
export const ORDER_STATUS = {
  0: '待支付',
  1: '开通中',
  2: '已取消',
  3: '已完成',
  4: '已折抵',
} as const

/** 订单类型。语义来自 OrderService::setOrderType() 与 OrderController::assign() */
export const ORDER_TYPE = {
  1: '新购',
  2: '续费',
  3: '变更订阅',
  4: '流量重置',
  9: '充值',
} as const

/**
 * 佣金状态。
 * CheckCommission 的流转是 0 →(待确认期满) 1 →(派发成功) 2。
 * ⚠️ order/update 只接受 0 / 1 / 3（OrderUpdate.php），**改不了 2**，
 * 也就是「已发放」不能手动回退。3 表示作废/无效。
 */
export const COMMISSION_STATUS = {
  0: '待确认',
  1: '发放中',
  2: '已发放',
  3: '无效',
} as const

/** order/update 允许写入的佣金状态（OrderUpdate.php 的 in:0,1,3） */
export const EDITABLE_COMMISSION_STATUS = [0, 1, 3] as const

/**
 * 只有这些订单状态的佣金才允许在前端手动改：已完成(3) / 已折抵(4)。
 * 与 CheckCommission::autoCheck 的 whereIn('status', [3, 4]) 保持一致。
 *
 * ⚠️ 为什么要前端拦：后端 order/update 不看订单状态，而
 * CheckCommission::autoPayCommission 每 15 分钟把**所有** commission_status=1
 * 且有邀请人的订单派佣，同样不看订单状态。setInvite() 在下单时就算好了
 * commission_balance，所以待支付(0) / 开通中(1) / 已取消(2) 的订单一旦被改成
 * 「发放中」，就会给没收到的钱真实打款。
 * 也不能允许把未完成订单改成「无效」：paid()/open() 不会重置 commission_status，
 * 用户之后付了款，这笔正常佣金就永久作废了。
 */
export const COMMISSION_EDITABLE_ORDER_STATUS = [3, 4] as const

/**
 * 订阅周期。取值来自 OrderAssign.php 的白名单，
 * 与 v2_plan 表的价格列一一对应（month_price 等）。
 */
export const ORDER_PERIODS = {
  month_price: '月付',
  quarter_price: '季付',
  half_year_price: '半年付',
  year_price: '年付',
  two_year_price: '两年付',
  three_year_price: '三年付',
  onetime_price: '一次性',
  reset_price: '流量重置包',
} as const

export type OrderPeriod = keyof typeof ORDER_PERIODS

/* ------------------------------------------------------------------ *
 * 过滤
 * ------------------------------------------------------------------ */

/**
 * 允许的过滤键，白名单来自 OrderFetch.php。
 *
 * ⚠️ `email` 这个键在后端是**坏的**：OrderController::filter() 里写的是
 *     User::where('email', "%{$value}%")
 * —— 用 `=` 去匹配带 % 的字符串，而不是 LIKE。查不到用户就 `continue`，
 * 于是过滤条件被静默丢弃、返回全部订单（不报错，只是筛选没生效）。
 * 因此前端**不提供** email 过滤，改用「用户 ID」；要按邮箱找单，
 * 先去用户管理查到 id 再来筛。
 */
export const ORDER_FILTER_KEYS = [
  'trade_no',
  'status',
  'commission_status',
  'user_id',
  'invite_user_id',
  'callback_no',
  'commission_balance',
] as const

export type OrderFilterKey = (typeof ORDER_FILTER_KEYS)[number]

export const ORDER_FILTER_CONDITIONS = [
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  '模糊',
] as const

export type OrderFilterCondition = (typeof ORDER_FILTER_CONDITIONS)[number]

export interface OrderFilter {
  key: OrderFilterKey
  condition: OrderFilterCondition
  value: string | number
}

/* ------------------------------------------------------------------ *
 * 列表
 * ------------------------------------------------------------------ */

/** 字段来自 v2_order 表结构 + fetch 里附加的 plan_name。金额单位统一是**分**。 */
export interface AdminOrder {
  id: number
  invite_user_id: number | null
  user_id: number
  plan_id: number | null
  coupon_id: number | null
  payment_id: number | null
  type: number
  period: string
  trade_no: string
  callback_no: string | null
  total_amount: number // 分（网关实付部分）
  handling_amount: number | null // 分（手续费）
  discount_amount: number | null // 分
  surplus_amount: number | null // 分（旧订单折抵价值）
  refund_amount: number | null // 分（折抵超出部分退回余额）
  balance_amount: number | null // 分（余额抵扣部分）
  surplus_order_ids: number[] | null
  status: number
  commission_status: number
  commission_balance: number // 分
  actual_commission_balance: number | null // 分
  paid_at: number | null
  created_at: number
  updated_at: number
  /** 后端在 fetch 里附加 */
  plan_name?: string
}

export interface OrderListQuery extends PageQuery {
  filter?: OrderFilter[]
  /** 传 1 只看有佣金的订单（invite_user_id 非空、status 不在 [0,2]、commission_balance>0） */
  is_commission?: 1
}

/**
 * ⚠️ 订单列表**不支持排序**：OrderController::fetch() 硬编码
 * `orderBy('created_at','DESC')`，忽略 sort / sort_type 参数。
 * 所以列定义里不要开 sorter，否则用户点了没反应。
 */
export function fetchOrders(query: OrderListQuery) {
  return callList<AdminOrder>(ADMIN_ENDPOINTS.order.fetch, query)
}

/** 佣金日志（detail 附带返回） */
export interface CommissionLogEntry {
  id: number
  invite_user_id: number
  user_id: number
  trade_no: string
  order_amount: number
  get_amount: number
  created_at: number
  updated_at: number
}

/**
 * ⚠️ detail **不带 plan_name**：OrderController::detail() 只是 Order::find()
 * 再挂上 commission_log / surplus_orders，plan_name 是 fetch 里另外拼的。
 * 这里把它从类型上去掉，免得页面读到一个永远是 undefined 的字段；
 * 套餐名请用 plan_id 去 fetchPlans() 的结果里查。
 */
export type OrderDetail = Omit<AdminOrder, 'plan_name'> & {
  commission_log?: CommissionLogEntry[]
  /** 本单折抵掉的旧订单（同样是裸 Order 行，没有 plan_name） */
  surplus_orders?: Omit<AdminOrder, 'plan_name'>[]
}

/** ⚠️ detail 取的是**主键 id**，不是 trade_no（OrderController::detail()） */
export function getOrderDetail(id: number) {
  return call<OrderDetail>(ADMIN_ENDPOINTS.order.detail, { id })
}

/* ------------------------------------------------------------------ *
 * 操作
 * ------------------------------------------------------------------ */

/**
 * 标记为已支付。只对 status=0 的订单有效，否则后端 abort(500,'只能对待支付的订单进行操作')。
 * 走的是 OrderService::paid()，callback_no 会记为 'manual_operation'。
 */
export function markOrderPaid(tradeNo: string) {
  return call<boolean>(ADMIN_ENDPOINTS.order.paid, { trade_no: tradeNo })
}

/**
 * 取消订单。同样只对 status=0 有效。
 * 会通过 OrderService::cancel() 退还已抵扣的余额（balance_amount）。
 */
export function cancelOrder(tradeNo: string) {
  return call<boolean>(ADMIN_ENDPOINTS.order.cancel, { trade_no: tradeNo })
}

/**
 * 更新订单。
 *
 * ⚠️ 尽管 OrderUpdate.php 同时校验了 status 和 commission_status，
 * 控制器里只取 `$request->only(['commission_status'])`
 * —— **订单状态改不了**，只能改佣金状态，且只能改成 0/1/3。
 *
 * ⚠️ 后端**不检查订单状态**，调用方必须自己先确认订单在
 * COMMISSION_EDITABLE_ORDER_STATUS 里（原因见该常量的注释）。
 * 改成 1（发放中）等于跳过 autoCheck 的 3 天审核期，下一轮 check:commission
 * （每 15 分钟）就会真实打款，且打款后变成 2，无法再改回。
 */
export function updateOrderCommissionStatus(
  tradeNo: string,
  commissionStatus: (typeof EDITABLE_COMMISSION_STATUS)[number],
) {
  return call<boolean>(ADMIN_ENDPOINTS.order.update, {
    trade_no: tradeNo,
    commission_status: commissionStatus,
  })
}

export interface OrderAssignPayload {
  /** 目标用户邮箱（必须已存在） */
  email: string
  plan_id: number
  period: OrderPeriod
  /** **分**。可以填 0（送一单） */
  total_amount: number
}

/**
 * 给指定用户手动开一张订单，返回 trade_no。
 *
 * 注意：创建出来的订单是**待支付**状态（status=0，后端没显式赋值），
 * 需要再调 markOrderPaid() 才会真正开通订阅。
 * 若该用户已有待支付订单，后端会拒绝（'该用户还有待支付的订单，无法分配'）。
 */
export function assignOrder(payload: OrderAssignPayload) {
  return call<string>(ADMIN_ENDPOINTS.order.assign, {
    ...payload,
  } as unknown as Record<string, unknown>)
}
