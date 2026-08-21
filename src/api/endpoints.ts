/**
 * 管理后台接口清单 —— 全部逐条抄自 app/Http/Routes/V1/AdminRoute.php，共 114 个。
 *
 * 所有路径都要拼上 adminApiBase = `/api/v1/${secure_path}`。
 * 不要在这里硬编码 secure_path。
 *
 * 维护约定：后端加/改路由时同步改这里。核对命令：
 *   grep -cE "router->(get|post)" app/Http/Routes/V1/AdminRoute.php   # 应等于 ENDPOINT_COUNT
 *
 * ⚠️ 其中 **5 个是死路由**：路由注册了但控制器里没有对应方法，调用必然 500
 * （已在测试机逐个实测）。它们保留在清单里是为了与后端路由一一对应，标了「死路由」的
 * 不要调用：
 *   - user/setInviteUser   → 用 user/update 的 invite_user_email 代替
 *   - notice/update        → 用 notice/save 带 id 代替
 *   - stat/getStat
 *   - stat/getRanking
 *   - stat/getStatRecord
 * 实际可用 109 个。
 */

export type HttpMethod = 'GET' | 'POST'

export interface Endpoint {
  readonly method: HttpMethod
  readonly path: string
}

const GET = (path: string): Endpoint => ({ method: 'GET', path })
const POST = (path: string): Endpoint => ({ method: 'POST', path })

/**
 * 8 种节点协议。经核对 AdminRoute.php:36-99，这 8 组的动作完全一致
 * （save/drop/update/copy，全部 POST），所以用生成而非手写 32 条。
 *
 * 备注：后端控制器复杂度差异很大，Phase 4 建议按此顺序推进（简单→复杂）：
 *   shadowsocks(90行) → trojan/vmess(91行) → tuic(111) → anytls(112)
 *   → hysteria(126) → vless(175) → v2node(244)
 */
export const SERVER_PROTOCOLS = [
  'shadowsocks',
  'trojan',
  'vmess',
  'tuic',
  'anytls',
  'hysteria',
  'vless',
  'v2node',
] as const

export type ServerProtocol = (typeof SERVER_PROTOCOLS)[number]

export const SERVER_PROTOCOL_ACTIONS = ['save', 'drop', 'update', 'copy'] as const

export type ServerProtocolAction = (typeof SERVER_PROTOCOL_ACTIONS)[number]

/** 协议节点操作的路径，例如 serverProtocolEndpoint('vless','copy') → POST /server/vless/copy */
export function serverProtocolEndpoint(
  protocol: ServerProtocol,
  action: ServerProtocolAction,
): Endpoint {
  return POST(`/server/${protocol}/${action}`)
}

export const ADMIN_ENDPOINTS = {
  /**
   * 系统配置（6）。
   * 实测口径：fetch 返回 **81** 个字段，ConfigSave 白名单 **84** 个。
   * 交集 81 —— 没有「只读」字段；差集是 3 个**可写但 fetch 不回显**的：
   * try_out_enable / telegram_discuss_id / telegram_channel_id。
   */
  config: {
    fetch: GET('/config/fetch'),
    save: POST('/config/save'),
    getEmailTemplate: GET('/config/getEmailTemplate'),
    getThemeTemplate: GET('/config/getThemeTemplate'),
    setTelegramWebhook: POST('/config/setTelegramWebhook'),
    testSendMail: POST('/config/testSendMail'),
  },

  /** 套餐（5） */
  plan: {
    fetch: GET('/plan/fetch'),
    save: POST('/plan/save'),
    drop: POST('/plan/drop'),
    update: POST('/plan/update'),
    sort: POST('/plan/sort'),
  },

  /** 节点分组 / 路由规则 / 节点总览（8） */
  server: {
    groupFetch: GET('/server/group/fetch'),
    groupSave: POST('/server/group/save'),
    groupDrop: POST('/server/group/drop'),
    routeFetch: GET('/server/route/fetch'),
    routeSave: POST('/server/route/save'),
    routeDrop: POST('/server/route/drop'),
    manageGetNodes: GET('/server/manage/getNodes'),
    manageSort: POST('/server/manage/sort'),
  },

  /** 订单（6） */
  order: {
    fetch: GET('/order/fetch'),
    update: POST('/order/update'),
    assign: POST('/order/assign'),
    paid: POST('/order/paid'),
    cancel: POST('/order/cancel'),
    detail: POST('/order/detail'),
  },

  /** 用户（11）—— 后端最大的控制器（392 行），Phase 1 的目标 */
  user: {
    fetch: GET('/user/fetch'),
    update: POST('/user/update'),
    getUserInfoById: GET('/user/getUserInfoById'),
    generate: POST('/user/generate'),
    dumpCSV: POST('/user/dumpCSV'),
    sendMail: POST('/user/sendMail'),
    ban: POST('/user/ban'),
    resetSecret: POST('/user/resetSecret'),
    delUser: POST('/user/delUser'),
    allDel: POST('/user/allDel'),
    /**
     * ⚠️ 死路由：AdminRoute.php:118 注册了，但 UserController 里没有
     * setInviteUser 方法，调用必然 500（测试机实测）。保留在清单里是为了
     * 与后端路由一一对应，**不要调用**。设置邀请人走 user/update 的
     * invite_user_email 字段。
     */
    setInviteUser: POST('/user/setInviteUser'),
  },

  /**
   * 统计（10 个里有 3 个是死路由）。
   * getStat / getRanking / getStatRecord 在 StatController 里都不存在，
   * 调用必然 500（已实测）。可用的只有 7 个。
   */
  stat: {
    /** ⚠️ 死路由，不要调用 */
    getStat: GET('/stat/getStat'),
    getOverride: GET('/stat/getOverride'),
    getServerLastRank: GET('/stat/getServerLastRank'),
    getServerTodayRank: GET('/stat/getServerTodayRank'),
    getUserLastRank: GET('/stat/getUserLastRank'),
    getUserTodayRank: GET('/stat/getUserTodayRank'),
    getOrder: GET('/stat/getOrder'),
    getStatUser: GET('/stat/getStatUser'),
    /** ⚠️ 死路由，不要调用 */
    getRanking: GET('/stat/getRanking'),
    /** ⚠️ 死路由，不要调用 */
    getStatRecord: GET('/stat/getStatRecord'),
  },

  /** 公告（5） */
  notice: {
    fetch: GET('/notice/fetch'),
    save: POST('/notice/save'),
    /** ⚠️ 死路由：NoticeController 没有 update 方法（实测 500）。编辑公告用 save 带 id。 */
    update: POST('/notice/update'),
    drop: POST('/notice/drop'),
    show: POST('/notice/show'),
  },

  /** 工单（3） */
  ticket: {
    fetch: GET('/ticket/fetch'),
    reply: POST('/ticket/reply'),
    close: POST('/ticket/close'),
  },

  /** 优惠券（4） */
  coupon: {
    fetch: GET('/coupon/fetch'),
    generate: POST('/coupon/generate'),
    drop: POST('/coupon/drop'),
    show: POST('/coupon/show'),
  },

  /** 礼品卡（3）—— fork 自定义功能，上游没有 */
  giftcard: {
    fetch: GET('/giftcard/fetch'),
    generate: POST('/giftcard/generate'),
    drop: POST('/giftcard/drop'),
  },

  /** 知识库（6） */
  knowledge: {
    fetch: GET('/knowledge/fetch'),
    getCategory: GET('/knowledge/getCategory'),
    save: POST('/knowledge/save'),
    show: POST('/knowledge/show'),
    drop: POST('/knowledge/drop'),
    sort: POST('/knowledge/sort'),
  },

  /** 支付网关（7） */
  payment: {
    fetch: GET('/payment/fetch'),
    getPaymentMethods: GET('/payment/getPaymentMethods'),
    getPaymentForm: POST('/payment/getPaymentForm'),
    save: POST('/payment/save'),
    drop: POST('/payment/drop'),
    show: POST('/payment/show'),
    sort: POST('/payment/sort'),
  },

  /**
   * 系统状态（5）。
   * ⚠️ getQueueMasters 直接指向 \Laravel\Horizon\...\MasterSupervisorController@index
   * （AdminRoute.php:168），响应结构是 Horizon 自己的格式，不是 v2board 的 {data,total}。
   */
  system: {
    getSystemStatus: GET('/system/getSystemStatus'),
    getQueueStats: GET('/system/getQueueStats'),
    getQueueWorkload: GET('/system/getQueueWorkload'),
    getQueueMasters: GET('/system/getQueueMasters'),
    getSystemLog: GET('/system/getSystemLog'),
  },

  /** 主题（3） */
  theme: {
    getThemes: GET('/theme/getThemes'),
    saveThemeConfig: POST('/theme/saveThemeConfig'),
    getThemeConfig: POST('/theme/getThemeConfig'),
  },
} as const

/**
 * 接口总数自检：上面显式列出的 + 8 协议 × 4 动作。
 * 与 `grep -cE "router->(get|post)" app/Http/Routes/V1/AdminRoute.php` 的结果对比。
 */
export const ENDPOINT_COUNT =
  Object.values(ADMIN_ENDPOINTS).reduce(
    (sum, group) => sum + Object.keys(group).length,
    0,
  ) +
  SERVER_PROTOCOLS.length * SERVER_PROTOCOL_ACTIONS.length
