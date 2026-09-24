import { adminApiBase } from '@/settings'
import { http, LONG_TIMEOUT } from './client'
import { ADMIN_ENDPOINTS } from './endpoints'
import { call, callList } from './request'
import type { DataResponse, PageQuery } from './types'

/* ================================================================== *
 * 优惠券
 * ================================================================== */

/**
 * 优惠券类型。白名单来自 CouponGenerate.php 的 in:1,2。
 *
 * type=2 故意不叫「百分比折扣」：中文里「折扣 90%」很容易被读成九折，
 * 而后端实际是按 value 减免（见 describeCouponRate），填 90 等于一折。
 */
export const COUPON_TYPES = {
  1: '固定金额',
  2: '按比例减免',
} as const

/**
 * type=2 优惠券 value 的中文含义（「减 x%」换算成「几折」）。
 *
 * ⚠️ value 是**减免**比例，不是「打几折」：CouponService::use 算的是
 * discount_amount = intdiv(total * value, 100)。填 10 是九折，填 90 是一折，填 100 是免费。
 * 用户「专属折扣」（OrderService::setVipDiscount）也是同样的减免语义。
 */
export function describeCouponRate(rate: number): string {
  if (!Number.isFinite(rate)) return ''
  // 后端同样把比例夹到 [0,100] 并取整
  const r = Math.max(0, Math.min(100, Math.round(rate)))
  if (r >= 100) return '免费'
  if (r <= 0) return '不打折'
  const pay = (100 - r) / 10
  return `${Number.isInteger(pay) ? pay : pay.toFixed(1)} 折`
}

/**
 * 把「可能是数组、也可能是 JSON 字符串」的字段统一解析成数组。
 *
 * 优惠券的 limit_plan_ids / limit_period、礼品卡的 used_user_ids 在库里都是 varchar，
 * 模型上挂了 array cast，正常情况下 fetch 返回的就是数组；但下面几种形态都真实存在，都要认：
 *   - 数组：模型 cast 解码后的正常形态
 *   - JSON 字符串 "[3,4]"：旧版后端 / 绕过模型读表的 fork
 *   - 双重编码：UserController::redeemgiftcard 先 json_encode 再赋给带 array cast 的
 *     used_user_ids，库里被编码了两次，cast 只解一层，fetch 返回的仍是字符串 "[5,8]"
 *   - 非 JSON 的单值：当成单元素数组，至少不丢
 *
 * 解析失败时**绝不能**返回空数组冒充「不限」—— 编辑优惠券时这会把限制静默清掉。
 */
export function parseJsonArray(raw: unknown): (string | number)[] {
  let value: unknown = raw
  // 最多解两层（覆盖上面的双重编码）
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    const text = value.trim()
    if (text === '') return []
    try {
      value = JSON.parse(text)
    } catch {
      return [text]
    }
  }
  if (Array.isArray(value)) return value as (string | number)[]
  if (typeof value === 'number' || (typeof value === 'string' && value !== '')) {
    return [value]
  }
  return []
}

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
  /**
   * **剩余**可用次数，不是总次数：每被用一次 CouponService::use 就把它减 1。
   * null = 不限次数。
   */
  limit_use: number | null
  /** null = 每人不限次数 */
  limit_use_with_user: number | null
  /**
   * 限定可用套餐。模型 cast 成 array，通常是数组，历史数据可能是 JSON 字符串、
   * 元素也可能是字符串 id，用 parseJsonArray 解析。null / 空 = 不限。
   */
  limit_plan_ids: string | (number | string)[] | null
  /** 限定可用周期（month_price 等），同上。null / 空 = 不限 */
  limit_period: string | string[] | null
  started_at: number
  ended_at: number
  created_at: number
  updated_at: number
}

export function fetchCoupons(query: PageQuery) {
  return callList<AdminCoupon>(ADMIN_ENDPOINTS.coupon.fetch, query)
}

/**
 * ⚠️ 编辑时「不传」和「传 null」是两回事：
 * CouponController::generate 编辑分支执行 Coupon::find(id)->update($request->validated())，
 * Laravel 8 的 validated() 只收请求里**出现过**的键（值为 null 也算出现）。所以
 *   - 键不出现 → 这一列不动；
 *   - 键为 null → 这一列被写成 NULL。对 limit_plan_ids / limit_period 来说 NULL 就是「不限」
 *     （CouponService::check 只在它们为真值时才校验），受限券会变成全站通用券。
 * 编辑时没改动的 limit_* 字段应当整个省略，不要发 null。
 */
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
    // 券码只在这次响应里回显：超时误报失败会让管理员重复生成一批、而第一批的 CSV 已经丢了
    { responseType: 'text', transformResponse: [(d) => d], timeout: LONG_TIMEOUT },
  )
  return response.data
}

/**
 * 切换显示状态（后端是取反，不是设值：$coupon->show = $coupon->show ? 0 : 1）。
 * 连点两次等于没改，调用方必须在请求期间锁住开关。
 */
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
  // UserController::redeemgiftcard：type=5 且 value == 0 时把 expired_at 置空，即永久套餐
  5: '天（0 = 永久）',
}

export interface AdminGiftcard {
  id: number
  code: string
  name: string
  type: number
  /** type=5 时 0 表示**永久**套餐（不是「0 天」） */
  value: number | null
  /** type=5 时必填 */
  plan_id: number | null
  /** **剩余**可兑换次数：每兑换一次后端减 1（redeemgiftcard）。null = 不限 */
  limit_use: number | null
  /**
   * 已兑换过的用户 id 列表。模型 cast 成 array 所以可能直接是数组，
   * 但兑换逻辑会双重编码，fetch 也可能返回 JSON 字符串 —— 用 parseJsonArray 解析。
   */
  used_user_ids: string | (number | string)[] | null
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
    // multiGenerate 每张卡都要按未建索引的 code 查重，卡多时很慢；卡密又只回显这一次
    { responseType: 'text', transformResponse: [(d) => d], timeout: LONG_TIMEOUT },
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
