import { adminApiBase } from '@/settings'
import { http } from './client'
import { ADMIN_ENDPOINTS } from './endpoints'
import { call, callList } from './request'
import type { DataResponse, PageQuery } from './types'

/* ================================================================== *
 * 优惠券
 * ================================================================== */

/** 优惠券类型。白名单来自 CouponGenerate.php 的 in:1,2 */
export const COUPON_TYPES = {
  1: '固定金额',
  2: '百分比折扣',
} as const

export interface AdminCoupon {
  id: number
  code: string
  name: string
  /** 1=金额 2=比例 */
  type: number
  /**
   * type=1 时是**分**；type=2 时是**百分比整数**（0-100）。
   * 后端 CSV 导出里就是这么区分的：['', value/100, value][type]
   */
  value: number
  show: number
  /** null = 不限次数 */
  limit_use: number | null
  /** null = 每人不限次数 */
  limit_use_with_user: number | null
  /** JSON 字符串或数组，限定可用套餐 */
  limit_plan_ids: string | number[] | null
  /** JSON 字符串或数组，限定可用周期 */
  limit_period: string | string[] | null
  started_at: number
  ended_at: number
  created_at: number
  updated_at: number
}

export function fetchCoupons(query: PageQuery) {
  return callList<AdminCoupon>(ADMIN_ENDPOINTS.coupon.fetch, query)
}

export interface CouponSavePayload {
  /** 带 id 是编辑 */
  id?: number
  name: string
  type: 1 | 2
  /** type=1 填分；type=2 填百分比整数 */
  value: number
  started_at: number
  ended_at: number
  limit_use?: number | null
  limit_use_with_user?: number | null
  limit_plan_ids?: number[] | null
  limit_period?: string[] | null
  /** 留空则后端生成 8 位随机码 */
  code?: string
}

/** 新增/编辑单张优惠券。返回 {data:true} */
export function saveCoupon(payload: CouponSavePayload) {
  return call<boolean>(ADMIN_ENDPOINTS.coupon.generate, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/**
 * 批量生成优惠券。
 *
 * ⚠️ 同一个 coupon/generate 接口，传了 generate_count 就走批量分支，
 * **返回 CSV 文本而不是 JSON**（CouponController::multiGenerate 用 echo）。
 * 批量生成的券固定 show=1。
 */
export async function generateCouponsBatch(
  payload: Omit<CouponSavePayload, 'id' | 'code'> & { generate_count: number },
): Promise<string> {
  const response = await http.post<string>(
    `${adminApiBase}${ADMIN_ENDPOINTS.coupon.generate.path}`,
    payload,
    { responseType: 'text', transformResponse: [(d) => d] },
  )
  return response.data
}

/** 切换显示状态（后端是取反，不是设值） */
export function toggleCouponShow(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.coupon.show, { id })
}

export function dropCoupon(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.coupon.drop, { id })
}

/* ================================================================== *
 * 礼品卡（fork 自定义功能，上游没有）
 * ================================================================== */

/**
 * 礼品卡类型。白名单来自 GiftcardGenerate.php 的 in:1,2,3,4,5，
 * 各类型 value 的含义取自 GiftcardController::multiGenerate 的 CSV 格式化逻辑：
 *   ['', round(value/100,2), value.'天', value.'GB', '-', value.'天'][type]
 */
export const GIFTCARD_TYPES = {
  1: '余额',
  2: '时长',
  3: '流量',
  4: '流量重置',
  5: '套餐时长',
} as const

/** 各类型 value 的单位说明，用于表单提示 */
export const GIFTCARD_VALUE_UNIT: Record<number, string> = {
  1: '分（显示时除以 100）',
  2: '天',
  3: 'GB',
  4: '不需要填',
  5: '天',
}

export interface AdminGiftcard {
  id: number
  code: string
  name: string
  type: number
  value: number | null
  /** type=5 时必填 */
  plan_id: number | null
  limit_use: number | null
  /** 已兑换过的用户 id 列表（JSON 字符串） */
  used_user_ids: string | null
  started_at: number
  ended_at: number
  created_at: number
  updated_at: number
}

export function fetchGiftcards(query: PageQuery) {
  return callList<AdminGiftcard>(ADMIN_ENDPOINTS.giftcard.fetch, query)
}

export interface GiftcardSavePayload {
  id?: number
  name: string
  /** 1 余额 / 2 时长 / 3 流量 / 4 重置 / 5 套餐时长 */
  type: 1 | 2 | 3 | 4 | 5
  /** type 为 1/2/3/5 时必填（后端 required_if），type=4 不需要 */
  value?: number | null
  /** type=5 时必填 */
  plan_id?: number | null
  started_at: number
  ended_at: number
  limit_use?: number | null
  /** 留空则后端生成 16 位随机码 */
  code?: string
}

export function saveGiftcard(payload: GiftcardSavePayload) {
  return call<boolean>(ADMIN_ENDPOINTS.giftcard.generate, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/** 批量生成礼品卡，同样**返回 CSV 文本**（含卡密，只有这一次能拿到） */
export async function generateGiftcardsBatch(
  payload: Omit<GiftcardSavePayload, 'id' | 'code'> & {
    generate_count: number
  },
): Promise<string> {
  const response = await http.post<string>(
    `${adminApiBase}${ADMIN_ENDPOINTS.giftcard.generate.path}`,
    payload,
    { responseType: 'text', transformResponse: [(d) => d] },
  )
  return response.data
}

export function dropGiftcard(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.giftcard.drop, { id })
}

/* ================================================================== *
 * 公告
 * ================================================================== */

export interface AdminNotice {
  id: number
  title: string
  content: string
  show: number
  img_url: string | null
  /** 后端校验是 array，但表里是 varchar，实际存的是 JSON 字符串 */
  tags: string | string[] | null
  created_at: number
  updated_at: number
}

/** notice/fetch 不分页，直接返回全部（按 id 倒序） */
export function fetchNotices() {
  return call<AdminNotice[]>(ADMIN_ENDPOINTS.notice.fetch)
}

export interface NoticeSavePayload {
  id?: number
  title: string
  content: string
  /** 必须是合法 URL（后端 nullable|url），空字符串会 422 */
  img_url?: string | null
  tags?: string[] | null
}

export function saveNotice(payload: NoticeSavePayload) {
  return call<boolean>(ADMIN_ENDPOINTS.notice.save, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

/** 切换显示（取反） */
export function toggleNoticeShow(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.notice.show, { id })
}

export function dropNotice(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.notice.drop, { id })
}

/**
 * ⚠️ 路由里有 notice/update，但 NoticeController **没有 update 方法**
 * （只有 fetch/save/show/drop）。调用会 500。编辑公告用 save 带 id。
 */

/* ================================================================== *
 * 知识库
 * ================================================================== */

export interface AdminKnowledgeListItem {
  id: number
  title: string
  category: string
  show: number
  updated_at: number
}

export interface AdminKnowledge extends AdminKnowledgeListItem {
  language: string
  body: string
  sort: number | null
  created_at: number
}

/**
 * 列表。不分页，只返回 title/id/updated_at/category/show 五个字段
 * （KnowledgeController::fetch 的 select），按 sort 升序。
 */
export function fetchKnowledgeList() {
  return call<AdminKnowledgeListItem[]>(ADMIN_ENDPOINTS.knowledge.fetch)
}

/** 同一个接口带 id 就返回单条全字段（含 body） */
export function fetchKnowledgeDetail(id: number) {
  return call<AdminKnowledge>(ADMIN_ENDPOINTS.knowledge.fetch, { id })
}

/** 已有的分类名列表，用于下拉候选 */
export function fetchKnowledgeCategories() {
  return call<string[]>(ADMIN_ENDPOINTS.knowledge.getCategory)
}

export interface KnowledgeSavePayload {
  id?: number
  category: string
  /** char(5)，如 zh-CN / en-US */
  language: string
  title: string
  body: string
}

export function saveKnowledge(payload: KnowledgeSavePayload) {
  return call<boolean>(ADMIN_ENDPOINTS.knowledge.save, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

export function toggleKnowledgeShow(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.knowledge.show, { id })
}

export function dropKnowledge(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.knowledge.drop, { id })
}

/** 按传入顺序重排（下标+1）。要传全量顺序。 */
export function sortKnowledge(knowledgeIds: number[]) {
  return call<boolean>(ADMIN_ENDPOINTS.knowledge.sort, {
    knowledge_ids: knowledgeIds,
  })
}

/** 供批量生成 CSV 下载复用的类型 */
export type { DataResponse }
