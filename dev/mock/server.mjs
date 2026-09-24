/**
 * V2Board 管理后台 SPA（v2board-admin）的零依赖 mock 后端 —— 用于本地截图。
 *
 * 运行：
 *     node server.mjs                      # 监听 127.0.0.1:18080
 *     PORT=18081 node server.mjs           # 换端口
 *     MOCK_DELAY=300 node server.mjs       # 每个请求人为延迟 300ms（看 loading 态）
 *     MOCK_STRICT=1 node server.mjs        # 与真实后端逐字一致（见下文「与页面期望不一致之处」）
 *
 * 配合 SPA（在 v2board-admin 目录，不用改仓库里的任何文件，环境变量优先级高于 .env.development）：
 *     bash:        VITE_API_TARGET=http://127.0.0.1:18080 npx vite
 *     PowerShell:  $env:VITE_API_TARGET='http://127.0.0.1:18080'; npx vite
 * 然后打开 http://localhost:5173/admin/v2/login ，任意邮箱 + 任意密码登录。
 *
 * 约定（全部对照 v2board-1kst 后端源码）：
 *   - 管理接口前缀 /api/v1/admin（secure_path = "admin"）；无 Authorization 头（也无 auth_data 参数）→ 403
 *   - 列表 {data, total}，current/pageSize 分页，pageSize < 10 强制为 10（与后端一致）
 *   - 金额单位「分」，用户流量「字节」，套餐流量「GB」，时间 unix 秒
 *   - user/generate(批量)、user/dumpCSV、coupon/generate(批量)、giftcard/generate(批量) 返回 CSV 纯文本
 *   - system/getQueueMasters 返回 Horizon 原生格式（不包 {data}）
 *   - 5 条死路由（user/setInviteUser、notice/update、stat/getStat、stat/getRanking、stat/getStatRecord）
 *     与真实后端一样返回 500
 *   - 未知路由：打印日志，返回 {data:true}（路径以 /fetch 结尾则 {data:[], total:0}）
 *   - GET /__mock/reset 把内存数据恢复到初始状态
 *
 * 与页面期望不一致之处（默认按页面期望返回以便截图好看，MOCK_STRICT=1 时按真实后端返回）：
 *   - giftcard.used_user_ids：真实后端 cast 成数组；GiftcardList 只会 JSON.parse 字符串
 *   - order/detail：真实后端不附加 plan_name；OrderDetailDrawer 会读它
 *
 * 只用 node:http / node:url。
 */

import http from 'node:http'
import { URL } from 'node:url'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 18080
const SECURE_PATH = 'admin'
const ADMIN_PREFIX = `/api/v1/${SECURE_PATH}`
const STRICT = process.env.MOCK_STRICT === '1'
const DELAY = Number(process.env.MOCK_DELAY) || 0

/* ================================================================== *
 * 工具
 * ================================================================== */

const GiB = 1073741824
const DAY = 86400
const CST = 8 * 3600 // 按北京时间切日/切月

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let rand = mulberry32(1)
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1))
const rf = (a, b) => a + rand() * (b - a)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const chance = (p) => rand() < p
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [v, w] of pairs) {
    r -= w
    if (r < 0) return v
  }
  return pairs[pairs.length - 1][0]
}
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const randomChar = (n, chars = CHARS) =>
  Array.from({ length: n }, () => chars[Math.floor(rand() * chars.length)]).join('')
const hex = (n) => randomChar(n, '0123456789abcdef')
const digits = (n) => randomChar(n, '0123456789')
/** Helper::guid()：32 位 hex；guid(true)：带横线的 UUID */
function guid(format = false) {
  const h = hex(32)
  if (!format) return h
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[ri(0, 3)]}${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const b64ish = (n) => randomChar(n, CHARS + '-_')

const NOW = Math.floor(Date.now() / 1000)
const dayStart = (ts) => Math.floor((ts + CST) / DAY) * DAY - CST
const TODAY = dayStart(NOW)
function cst(ts) {
  const d = new Date((ts + CST) * 1000)
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    H: d.getUTCHours(),
    i: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    dow: d.getUTCDay(),
  }
}
const pad = (n, w = 2) => String(n).padStart(w, '0')
function monthStart(ts) {
  const p = cst(ts)
  return Date.UTC(p.y, p.m - 1, 1) / 1000 - CST
}
const MONTH_START = monthStart(NOW)
const LAST_MONTH_START = monthStart(MONTH_START - 1)
/** PHP date('Y-m-d H:i:s') */
function phpDate(ts) {
  const p = cst(ts)
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.H)}:${pad(p.i)}:${pad(p.s)}`
}
/** Helper::generateOrderNo()：date('YmdHms')（原文就是两个 m）+ 6 位微秒 + 5 位随机 */
function orderNo(ts) {
  const p = cst(ts)
  return `${p.y}${pad(p.m)}${pad(p.d)}${pad(p.H)}${pad(p.m)}${pad(p.s)}${digits(6)}${ri(10000, 99999)}`
}
/** 某个时间点之后、NOW 之前的随机时刻 */
const between = (from, to = NOW) => (to <= from ? to : ri(from, to))

const CN_IP_PREFIX = ['117.136', '223.104', '112.64', '180.162', '183.14', '120.229', '36.112', '114.86', '101.88', '58.33', '222.73', '125.119']
const randomIp = () => `${pick(CN_IP_PREFIX)}.${ri(1, 254)}.${ri(1, 254)}`

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}
function abort(status, message, extra) {
  throw new HttpError(status, message, extra)
}
function validation(field, message) {
  abort(422, message, { errors: { [field]: [message] } })
}
const deadRoute = (controller, method) => () =>
  abort(500, `Method App\\Http\\Controllers\\V1\\Admin\\${controller}::${method} does not exist.`)

/** 纯文本响应（PHP echo 出来的 CSV 等） */
class Raw {
  constructor(body, type = 'text/html; charset=UTF-8', status = 200) {
    this.body = body
    this.type = type
    this.status = status
  }
}

const int = (v, d = null) => {
  if (v === null || v === undefined || v === '') return d
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : d
}
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const has = (obj, k) => obj != null && Object.prototype.hasOwnProperty.call(obj, k)
/** PHP 数组 / JS 数组 / 单值 → 数组 */
function asList(v) {
  if (v === null || v === undefined || v === '') return []
  if (Array.isArray(v)) return v
  if (typeof v === 'object') return Object.values(v)
  return [v]
}
/** {k: v} 或 [[k, v]] → entries */
function asEntries(v) {
  if (!v || typeof v !== 'object') return []
  return Object.entries(v)
}
const nextId = (rows) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1

function sortBy(rows, key, dir = 'ASC') {
  const m = String(dir).toUpperCase() === 'DESC' ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = a[key]
    const y = b[key]
    // MySQL：NULL 在 ASC 时最前、DESC 时最后
    if (x == null && y == null) return 0
    if (x == null) return -1 * m
    if (y == null) return 1 * m
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * m
    const nx = Number(x)
    const ny = Number(y)
    if (x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny)) return (nx - ny) * m
    return String(x).localeCompare(String(y)) * m
  })
}

function paginate(rows, input, sizeKey = 'pageSize') {
  const current = Math.max(1, int(input.current, 1) || 1)
  const ps = int(input[sizeKey], 0)
  const pageSize = ps >= 10 ? ps : 10
  return { data: rows.slice((current - 1) * pageSize, current * pageSize), total: rows.length }
}

/** 过滤条件比较（UserController/OrderController::filter 的宽松复刻） */
function compare(a, cond, b) {
  if (cond === '模糊' || cond === 'like') {
    return String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase())
  }
  if (a === null || a === undefined) return cond === '!=' ? true : false
  const na = Number(a)
  const nb = Number(b)
  const numeric = a !== '' && b !== '' && b !== null && Number.isFinite(na) && Number.isFinite(nb)
  const x = numeric ? na : String(a)
  const y = numeric ? nb : String(b)
  switch (cond) {
    case '=':
      return x === y
    case '!=':
      return x !== y
    case '>':
      return x > y
    case '<':
      return x < y
    case '>=':
      return x >= y
    case '<=':
      return x <= y
    default:
      return true
  }
}
function readFilters(input) {
  return asList(input.filter).filter((f) => f && typeof f === 'object' && f.key !== undefined)
}

/* ================================================================== *
 * PHP 风格参数解析：a[b][c]=x、a[]=x
 * ================================================================== */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function normalizeArrays(v) {
  if (!v || typeof v !== 'object') return v
  const keys = Object.keys(v)
  for (const k of keys) v[k] = normalizeArrays(v[k])
  if (keys.length > 0 && keys.every((k, i) => k === String(i))) return keys.map((k) => v[k])
  return v
}

function parsePhpParams(searchParams) {
  const out = {}
  for (const [rawKey, value] of searchParams) {
    const m = rawKey.match(/^([^[\]]+)((?:\[[^\]]*\])*)$/)
    const path = m ? [m[1], ...[...m[2].matchAll(/\[([^\]]*)\]/g)].map((x) => x[1])] : [rawKey]
    if (path.some((seg) => FORBIDDEN_KEYS.has(seg))) continue
    let cur = out
    for (let i = 0; i < path.length; i++) {
      let seg = path[i]
      if (seg === '') seg = String(Object.keys(cur).length)
      if (i === path.length - 1) {
        cur[seg] = value
      } else {
        if (!cur[seg] || typeof cur[seg] !== 'object') cur[seg] = {}
        cur = cur[seg]
      }
    }
  }
  return normalizeArrays(out)
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve({})
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size <= 5 * 1024 * 1024) chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) return resolve({})
      const type = String(req.headers['content-type'] || '')
      const asJson = () => {
        try {
          const v = JSON.parse(text)
          return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
        } catch {
          return null
        }
      }
      const asForm = () => {
        try {
          return parsePhpParams(new URLSearchParams(text))
        } catch {
          return {}
        }
      }
      if (type.includes('application/json')) return resolve(asJson() ?? {})
      if (type.includes('application/x-www-form-urlencoded')) return resolve(asForm())
      if (type.includes('multipart/form-data')) return resolve({})
      resolve(asJson() ?? asForm())
    })
    req.on('error', () => resolve({}))
  })
}

/* ================================================================== *
 * 静态字典
 * ================================================================== */

const DOMAIN = 'xingyun.example' // .example 为保留域名，保证是假的

const PERIOD_KEYS = [
  'month_price',
  'quarter_price',
  'half_year_price',
  'year_price',
  'two_year_price',
  'three_year_price',
  'onetime_price',
  'reset_price',
]
const PERIOD_LABELS = {
  month_price: '月付',
  quarter_price: '季付',
  half_year_price: '半年付',
  year_price: '年付',
  two_year_price: '两年付',
  three_year_price: '三年付',
  onetime_price: '一次性',
  reset_price: '流量重置包',
}
const PERIOD_DAYS = {
  month_price: 30,
  quarter_price: 90,
  half_year_price: 180,
  year_price: 365,
  two_year_price: 730,
  three_year_price: 1095,
  onetime_price: 3650,
  reset_price: 0,
}

const PROTOCOLS = ['shadowsocks', 'trojan', 'vmess', 'tuic', 'anytls', 'hysteria', 'vless', 'v2node']

const PINYIN = [
  'zhangwei', 'wangfang', 'lina', 'liuyang', 'chenjie', 'yangmin', 'zhaolei', 'huangli',
  'zhouqiang', 'wuxia', 'xujun', 'sunhao', 'maxiaoyu', 'zhuyan', 'hutao', 'guojing',
  'linfeng', 'heqian', 'gaoyuan', 'luobin', 'zhengshuang', 'liangchen', 'xiehui', 'songjia',
  'tangxin', 'hanmei', 'fengyi', 'dengchao', 'caoyu', 'pengfei', 'zengli', 'xiaoming',
  'tianye', 'dongxue', 'yuanhao', 'panwen', 'jiangtao', 'caiyun', 'duyue', 'shenlang',
  'weikai', 'renjie', 'lujia', 'yaoyao', 'qinfang', 'fanbing', 'fuhua', 'cuihao',
  'kongling', 'baixue', 'jinyu', 'shiyi',
]
const MAIL_DOMAINS = [
  ['qq.com', 30], ['163.com', 14], ['gmail.com', 16], ['outlook.com', 8], ['foxmail.com', 6],
  ['126.com', 6], ['icloud.com', 6], ['hotmail.com', 4], ['sina.com', 3], ['yeah.net', 2],
]

const ANYTLS_PADDING = [
  'stop=8',
  '0=30-30',
  '1=100-400',
  '2=400-500,c,500-1000,c,500-1000,c,500-1000,c,500-1000',
  '3=9-9,500-1000',
  '4=500-1000',
  '5=500-1000',
  '6=500-1000',
  '7=500-1000',
]

const PAYMENT_METHODS = [
  'Paytaro', 'PaytaroQR', 'AlipayF2F', 'BEasyPaymentUSDT', 'BTCPay', 'CoinPayments', 'Coinbase',
  'EPay', 'EPayQrcode', 'Epusdt', 'StripeALL', 'StripeAlipay', 'StripeCheckout', 'StripeCredit',
  'StripeWepay', 'WechatPayNative',
]

/** 各网关 form()（逐字取自 app/Payments/*.php；没抄的用通用表单兜底） */
const PAYMENT_FORMS = {
  EPay: {
    url: { label: 'URL', description: '', type: 'input' },
    pid: { label: 'PID', description: '', type: 'input' },
    key: { label: 'KEY', description: '', type: 'input' },
    type: { label: 'TYPE', description: '支付类型，如: alipay, wxpay, qqpay', type: 'input' },
  },
  AlipayF2F: {
    app_id: { label: '支付宝APPID', description: '', type: 'input' },
    private_key: { label: '支付宝私钥', description: '', type: 'input' },
    public_key: { label: '支付宝公钥', description: '', type: 'input' },
    product_name: { label: '自定义商品名称', description: '将会体现在支付宝账单中', type: 'input' },
  },
  Epusdt: {
    epusdt_url: { label: 'API 地址', description: 'Epusdt API 接口地址(例如: https://xxx.com)', type: 'input' },
    epusdt_pid: { label: 'PID', description: 'Epusdt 后台的 pid', type: 'input' },
    epusdt_token: { label: 'Token', description: 'Epusdt 后台的 secret_key', type: 'input' },
    epusdt_currency: { label: '法币', description: '默认 cny', type: 'input' },
    epusdt_asset: { label: '代币', description: '默认 usdt', type: 'input' },
    epusdt_network: {
      label: '网络',
      description: '留空时进入 GMPay 选择链路界面，填写时按该网络直接发起订单',
      type: 'input',
    },
  },
  StripeCheckout: {
    currency: { label: '货币单位', description: '', type: 'input' },
    stripe_sk_live: { label: 'SK_LIVE', description: 'API 密钥', type: 'input' },
    stripe_pk_live: { label: 'PK_LIVE', description: 'API 公钥', type: 'input' },
    stripe_webhook_key: { label: 'WebHook 密钥签名', description: '', type: 'input' },
    stripe_custom_field_name: {
      label: '自定义字段名称',
      description: '例如可设置为“联系方式”，以便及时与客户取得联系',
      type: 'input',
    },
  },
  Paytaro: {
    pid: { label: 'App ID', description: 'Paytaro 应用的 App ID；', type: 'input' },
    key: { label: 'App Secret', description: 'Paytaro 应用的 App Secret；', type: 'input' },
    alert1: { type: 'alert', content: '开户 / 开通支付方式请联系商务' },
  },
}
PAYMENT_FORMS.EPayQrcode = PAYMENT_FORMS.EPay
PAYMENT_FORMS.PaytaroQR = PAYMENT_FORMS.Paytaro
const GENERIC_PAYMENT_FORM = {
  api_url: { label: 'API 地址', description: '', type: 'input' },
  merchant_id: { label: '商户号', description: '', type: 'input' },
  secret_key: { label: '密钥', description: '', type: 'input' },
}

/** 主题 config.json（default 逐字取自 public/theme/default/config.json；nebula 为虚构的第二个主题） */
const THEMES = {
  default: {
    name: 'default',
    description: '默认主题',
    version: '1.7.5',
    images:
      'https://images.unsplash.com/photo-1515405295579-ba7b45403062?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=2160&q=80',
    configs: [
      {
        label: '主题色',
        placeholder: '请选择主题颜色',
        field_name: 'theme_color',
        field_type: 'select',
        select_options: { default: '默认(蓝色)', green: '奶绿色', black: '黑色', darkblue: '暗蓝色' },
        default_value: 'default',
      },
      { label: '背景', placeholder: '请输入背景图片URL', field_name: 'background_url', field_type: 'input' },
      {
        label: '边栏风格',
        placeholder: '请选择边栏风格',
        field_name: 'theme_sidebar',
        field_type: 'select',
        select_options: { light: '亮', dark: '暗' },
        default_value: 'light',
      },
      {
        label: '顶部风格',
        placeholder: '请选择顶部风格',
        field_name: 'theme_header',
        field_type: 'select',
        select_options: { light: '亮', dark: '暗' },
        default_value: 'dark',
      },
      {
        label: '自定义页脚HTML',
        placeholder: '可以实现客服JS代码的加入等',
        field_name: 'custom_html',
        field_type: 'textarea',
      },
    ],
  },
  nebula: {
    name: 'nebula',
    description: '星云主题：深色玻璃拟态风格，针对移动端优化，内置公告弹窗与客服入口',
    version: '2.3.1',
    images: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=2160&q=80',
    configs: [
      {
        label: '主题色',
        field_name: 'theme_color',
        field_type: 'select',
        select_options: { purple: '星云紫', blue: '深海蓝', green: '极光绿', orange: '日落橙' },
        default_value: 'purple',
      },
      { label: '首页标语', field_name: 'hero_title', field_type: 'input', default_value: '连接世界，从未如此简单' },
      { label: '首页副标语', field_name: 'hero_subtitle', field_type: 'input' },
      { label: '背景图片', field_name: 'background_url', field_type: 'input' },
      { label: '登录后弹出最新公告', field_name: 'notice_popup', field_type: 'switch', default_value: 1 },
      { label: '显示邀请返利入口', field_name: 'show_invite', field_type: 'switch', default_value: 1 },
      {
        label: '默认语言',
        field_name: 'default_locale',
        field_type: 'select',
        select_options: ['zh-CN', 'zh-TW', 'en-US', 'ja-JP'],
        default_value: 'zh-CN',
      },
      { label: 'Crisp 客服 Website ID', field_name: 'crisp_id', field_type: 'input' },
      { label: '自定义页脚 HTML', field_name: 'custom_html', field_type: 'textarea' },
    ],
  },
}

/* ================================================================== *
 * 初始数据
 * ================================================================== */

function buildState() {
  rand = mulberry32(20260924)
  const S = {}

  /* ------------------------------ 系统配置 ------------------------------ */
  S.config = {
    ticket: { ticket_status: 0 },
    deposit: { deposit_bounus: ['50:5', '100:15', '200:40', '500:120'] },
    invite: {
      invite_force: 0,
      invite_commission: 15,
      invite_gen_limit: 5,
      invite_never_expire: 1,
      commission_first_time_enable: 0,
      commission_auto_check_enable: 1,
      commission_withdraw_limit: 100,
      commission_withdraw_method: ['支付宝', 'USDT', 'Paypal'],
      withdraw_close_enable: 0,
      commission_distribution_enable: 0,
      commission_distribution_l1: null,
      commission_distribution_l2: null,
      commission_distribution_l3: null,
    },
    site: {
      logo: `https://www.${DOMAIN}/static/logo.png`,
      force_https: 1,
      stop_register: 0,
      app_name: '星云加速',
      app_description: '稳定 · 高速 · 全球互联',
      app_url: `https://www.${DOMAIN}`,
      subscribe_url: `https://sub1.${DOMAIN},https://sub2.${DOMAIN}`,
      subscribe_path: '/api/v1/client/subscribe',
      try_out_plan_id: 1,
      try_out_hour: 72,
      tos_url: `https://www.${DOMAIN}/tos`,
      currency: 'CNY',
      currency_symbol: '¥',
    },
    subscribe: {
      plan_change_enable: 1,
      reset_traffic_method: 0,
      surplus_enable: 1,
      allow_new_period: 0,
      new_order_event_id: 0,
      renew_order_event_id: 0,
      change_order_event_id: 0,
      show_info_to_server_enable: 1,
      show_subscribe_method: 0,
      show_subscribe_expire: 5,
    },
    frontend: {
      frontend_theme: 'default',
      frontend_theme_sidebar: 'light',
      frontend_theme_header: 'dark',
      frontend_theme_color: 'default',
      frontend_background_url: null,
    },
    server: {
      server_api_url: `https://api.${DOMAIN}`,
      server_token: randomChar(32),
      server_pull_interval: 60,
      server_push_interval: 60,
      server_node_report_min_traffic: 0,
      server_device_online_min_traffic: 0,
      device_limit_mode: 0,
    },
    email: {
      email_template: 'default',
      email_host: 'smtp.exmail.qq.com',
      email_port: '465',
      email_username: `noreply@${DOMAIN}`,
      email_password: randomChar(16),
      email_encryption: 'ssl',
      email_from_address: `noreply@${DOMAIN}`,
    },
    telegram: {
      telegram_bot_enable: 1,
      telegram_bot_token: `${ri(6000000000, 7999999999)}:AA${b64ish(33)}`,
      telegram_discuss_link: 'https://t.me/example_chat',
    },
    app: {
      windows_version: '2.2.3',
      windows_download_url: `https://dl.${DOMAIN}/client/Clash.Verge_2.2.3_x64-setup.exe`,
      macos_version: '2.2.3',
      macos_download_url: `https://dl.${DOMAIN}/client/Clash.Verge_2.2.3_aarch64.dmg`,
      android_version: '2.11.4',
      android_download_url: `https://dl.${DOMAIN}/client/cmfa-2.11.4-meta-universal-release.apk`,
    },
    safe: {
      email_verify: 1,
      safe_mode_enable: 0,
      secure_path: SECURE_PATH,
      email_whitelist_enable: 1,
      email_whitelist_suffix: ['gmail.com', 'qq.com', '163.com', 'yahoo.com', 'sina.com', '126.com', 'outlook.com', 'yeah.net', 'foxmail.com'],
      email_gmail_limit_enable: 1,
      recaptcha_enable: 1,
      recaptcha_key: `0x4AAAAAAA${b64ish(22)}`,
      recaptcha_site_key: `0x4AAAAAAA${b64ish(12)}`,
      register_limit_by_ip_enable: 1,
      register_limit_count: 3,
      register_limit_expire: 60,
      password_limit_enable: 1,
      password_limit_count: 5,
      password_limit_expire: 60,
    },
  }
  /** 可写但 fetch 不回显的 3 个字段（ConfigSave 白名单里有、fetch 里没有） */
  S.writeOnlyConfig = { try_out_enable: 1, telegram_discuss_id: null, telegram_channel_id: null }

  /* ------------------------------ 权限组 ------------------------------ */
  const groupNames = ['基础线路', '高级线路', 'IPLC 专线', '游戏加速', '流媒体解锁', '体验专用', '备用线路']
  S.groups = groupNames.map((name, i) => ({
    id: i + 1,
    name,
    created_at: NOW - (560 - i * 40) * DAY,
    updated_at: NOW - (200 - i * 20) * DAY,
  }))

  /* ------------------------------ 路由规则 ------------------------------ */
  const routeDefs = [
    ['屏蔽 BT / PT 下载', ['bittorrent'], 'protocol', null],
    ['屏蔽广告与追踪域名', ['geosite:category-ads-all'], 'block', null],
    ['屏蔽测速网站', ['geosite:speedtest', 'domain:fast.com'], 'block', null],
    ['屏蔽回国流量', ['geoip:cn', 'geoip:private'], 'block_ip', null],
    ['屏蔽 SMTP 端口', ['25', '465', '587'], 'block_port', null],
    ['Netflix / Disney+ 走解锁出口', ['geosite:netflix', 'geosite:disney'], 'route', 'unlock-sg'],
    ['ChatGPT 走美国落地', ['geosite:openai', 'domain:chatgpt.com'], 'route', 'us-residential'],
    ['Telegram IP 段走香港', ['geoip:telegram'], 'route_ip', 'hk-direct'],
    ['流媒体 DNS 解锁', ['geosite:netflix', 'geosite:hulu'], 'dns', '203.0.113.53'],
    ['默认出口', [], 'default_out', 'direct'],
  ]
  S.routes = routeDefs.map(([remarks, match, action, action_value], i) => ({
    id: i + 1,
    remarks,
    match,
    action,
    action_value,
    created_at: NOW - (300 - i * 25) * DAY,
    updated_at: NOW - (120 - i * 10) * DAY,
  }))

  /* ------------------------------ 套餐 ------------------------------ */
  const planContent = (lines) => lines.map((l) => `✅ ${l}`).join('\n')
  const P = (o) => ({
    content: null,
    device_limit: null,
    speed_limit: null,
    show: 1,
    renew: 1,
    month_price: null,
    quarter_price: null,
    half_year_price: null,
    year_price: null,
    two_year_price: null,
    three_year_price: null,
    onetime_price: null,
    reset_price: null,
    reset_traffic_method: null,
    capacity_limit: null,
    ...o,
  })
  S.plans = [
    P({ id: 1, group_id: 6, name: '新人体验 3 天', transfer_enable: 20, device_limit: 2, renew: 0, onetime_price: 100, reset_traffic_method: 2, capacity_limit: 200,
      content: planContent(['20GB 流量，3 天有效', '香港 / 日本体验节点', '每个账号限购一次']) }),
    P({ id: 2, group_id: 1, name: '月付 Lite', transfer_enable: 100, device_limit: 3, month_price: 1500, quarter_price: 4200, half_year_price: 8200, year_price: 15800, reset_price: 800,
      content: planContent(['每月 100GB 流量', '基础线路（香港 / 日本 / 新加坡 / 美国）', '最多 3 台设备同时在线']) }),
    P({ id: 3, group_id: 2, name: '月付 Pro', transfer_enable: 300, device_limit: 5, month_price: 2500, quarter_price: 6900, half_year_price: 13500, year_price: 25800, two_year_price: 48800, reset_price: 1500,
      content: planContent(['每月 300GB 流量', '全部高级线路 + 部分 IPLC', '最多 5 台设备同时在线', '支持 Netflix / ChatGPT']) }),
    P({ id: 4, group_id: 3, name: '月付 Ultra', transfer_enable: 800, device_limit: 8, month_price: 4800, quarter_price: 13800, half_year_price: 26800, year_price: 49800, reset_price: 2800,
      content: planContent(['每月 800GB 流量', '全部 IPLC 专线，晚高峰不拥堵', '最多 8 台设备同时在线', '专属客服通道']) }),
    P({ id: 5, group_id: 5, name: '流媒体解锁版', transfer_enable: 500, device_limit: 5, month_price: 3500, quarter_price: 9900, year_price: 36800,
      content: planContent(['每月 500GB 流量', 'Netflix / Disney+ / HBO Max 全解锁', '4K 不缓冲']) }),
    P({ id: 6, group_id: 4, name: '游戏加速 专线', transfer_enable: 200, device_limit: 3, month_price: 3000, quarter_price: 8500,
      content: planContent(['每月 200GB 流量', '香港 / 日本游戏专线，全程 UDP', 'APEX / Valorant / 原神 国际服']) }),
    P({ id: 7, group_id: 3, name: '年付 企业版', transfer_enable: 3000, device_limit: 50, year_price: 198800, two_year_price: 368800, three_year_price: 518800, reset_traffic_method: 1, capacity_limit: 30,
      content: planContent(['每月 3000GB 流量', '全部线路 + 企业独享入口', '50 台设备', '支持对公转账']) }),
    P({ id: 8, group_id: 1, name: '不限时 500G 流量包', transfer_enable: 500, device_limit: 3, show: 0, renew: 0, onetime_price: 6800, reset_traffic_method: 2,
      content: planContent(['500GB 流量，用完为止', '不限使用时间']) }),
  ].map((p, i) => ({ ...p, sort: i + 1, created_at: NOW - (500 - i * 30) * DAY, updated_at: NOW - (60 - i * 5) * DAY }))
  const planById = (id) => S.plans.find((p) => p.id === id)

  /* ------------------------------ 用户 ------------------------------ */
  const N_USERS = 52
  const usedEmails = new Set()
  function makeEmail(i) {
    for (let tries = 0; tries < 20; tries++) {
      const dom = weighted(MAIL_DOMAINS)
      const name = PINYIN[(i + tries * 7) % PINYIN.length]
      let local
      if (dom === 'qq.com' && chance(0.55)) local = String(ri(100000000, 3999999999))
      else {
        local = pick([
          name,
          `${name}${ri(1, 99)}`,
          `${name}${ri(1985, 2004)}`,
          `${name.slice(0, 1)}${name.slice(1)}_${ri(10, 999)}`,
          `${name}.${pick(['vip', 'work', 'hz', 'sh', 'bj', 'gz'])}`,
        ])
      }
      const email = `${local}@${dom}`
      if (!usedEmails.has(email)) {
        usedEmails.add(email)
        return email
      }
    }
    return `user${i}@${DOMAIN}`
  }
  const PROMOTERS = [3, 7, 12, 18]
  const REMARKS = ['老用户，续费 5 次', '代理商', '工单投诉过线路', '大客户，年付企业版', '学生党', '朋友推荐', 'Telegram 群管理员', '支付宝退款过一次', '海外留学生']
  S.users = []
  S.alive = {}
  for (let id = 1; id <= N_USERS; id++) {
    let created
    if (id <= 2) created = NOW - 620 * DAY + id * 3600
    else if (id > N_USERS - 4) created = Math.min(NOW - 60, Math.max(TODAY + 60, NOW - ri(600, 36000)))
    else {
      const frac = (id - 3) / (N_USERS - 4 - 3)
      created = NOW - Math.round((1 - frac) ** 1.3 * 600 * DAY) - DAY / 2 - ri(0, 20000)
    }
    const isAdmin = id === 1
    const isStaff = id === 2
    let planId
    if (isAdmin) planId = 7
    else if (isStaff) planId = 3
    else if (id > N_USERS - 4) planId = weighted([[null, 2], [1, 2]])
    else planId = weighted([[null, 12], [1, 4], [2, 18], [3, 30], [4, 10], [5, 9], [6, 7], [7, 3]])
    const plan = planId ? planById(planId) : null

    let expired
    if (!plan) expired = 0
    else if (isAdmin || isStaff) expired = null
    else if (plan.id === 1) expired = created + 3 * DAY
    else if (plan.id === 7) expired = chance(0.4) ? null : NOW + ri(60, 700) * DAY
    else {
      const r = rand()
      if (r < 0.08) expired = NOW + ri(3600, 3 * DAY) // 即将到期
      else if (r < 0.26) expired = NOW - ri(1, 90) * DAY - ri(0, DAY) // 已过期
      else expired = NOW + ri(5, 360) * DAY - ri(0, DAY)
    }

    const transfer = plan ? plan.transfer_enable * GiB : 0
    const usedFrac = !plan ? 0 : weighted([[rf(0.02, 0.35), 55], [rf(0.35, 0.8), 30], [rf(0.8, 0.99), 10], [rf(1.0, 1.02), 5]])
    const used = Math.round(transfer * usedFrac)
    const u = Math.round(used * rf(0.04, 0.12))
    const d = used - u

    const online = plan && expired !== 0 && (expired === null || expired > NOW) && chance(0.45)
    const t = !plan ? 0 : online ? NOW - ri(10, 580) : NOW - ri(1, 30) * DAY - ri(0, DAY)
    const deviceLimit = plan ? plan.device_limit : null
    if (online) {
      const n = ri(1, Math.min(deviceLimit || 3, 4))
      const ips = Array.from({ length: n }, () => `${randomIp()}_${pick(['vless1', 'vless2', 'v2node1', 'trojan1', 'hysteria1', 'anytls1'])}`)
      S.alive[id] = { alive_ip: n, ips: ips.join(', ') }
    }

    const neverLogin = id > N_USERS - 4 ? false : chance(0.06)
    const loginFrom = Math.min(created + 60, NOW)
    const lastLogin = neverLogin ? null : between(loginFrom, Math.max(loginFrom, NOW - ri(0, 3 * DAY)))
    const promoter = PROMOTERS.includes(id)
    const banned = id === 15 || id === 33 ? 1 : 0
    let remarks = chance(0.22) ? pick(REMARKS) : null
    if (id === 15) remarks = '分享订阅被封禁（30+ IP）'
    if (id === 33) remarks = '恶意刷流量'
    if (id === 7 || id === 12) remarks = '代理商'
    if (isAdmin) remarks = '站长'
    if (isStaff) remarks = '客服'
    const inviter = id > 12 && chance(0.38) ? pick(PROMOTERS.filter((p) => p < id)) : null

    S.users.push({
      id,
      invite_user_id: inviter,
      telegram_id: chance(0.3) ? ri(100000000, 7999999999) : null,
      email: isAdmin ? `admin@${DOMAIN}` : isStaff ? `kefu@${DOMAIN}` : makeEmail(id),
      balance: isAdmin ? 0 : chance(0.3) ? pick([368, 500, 1200, 2580, 5000, 10000]) : 0,
      discount: id === 12 ? 90 : null,
      commission_type: id === 12 ? 2 : 0,
      commission_rate: id === 7 ? 30 : id === 12 ? 25 : null,
      commission_balance: promoter ? ri(20, 800) * 100 + ri(0, 99) : 0,
      t,
      u,
      d,
      transfer_enable: transfer,
      device_limit: deviceLimit,
      banned,
      is_admin: isAdmin ? 1 : 0,
      is_staff: isStaff ? 1 : 0,
      last_login_at: lastLogin,
      last_login_ip: lastLogin ? randomIp() : null,
      uuid: guid(true),
      group_id: plan ? plan.group_id : null,
      plan_id: plan ? plan.id : null,
      speed_limit: plan ? plan.speed_limit : null,
      auto_renewal: chance(0.2) ? 1 : 0,
      remind_expire: chance(0.85) ? 1 : 0,
      remind_traffic: chance(0.85) ? 1 : 0,
      token: hex(32),
      expired_at: expired,
      remarks,
      created_at: created,
      updated_at: Math.max(created, lastLogin || 0),
    })
  }
  const userById = (id) => S.users.find((u) => u.id === id)

  /* ------------------------------ 支付方式 ------------------------------ */
  const PM = (o) => ({ icon: null, notify_domain: null, handling_fee_fixed: null, handling_fee_percent: null, enable: 1, ...o })
  S.payments = [
    PM({ payment: 'AlipayF2F', name: '支付宝', notify_domain: `https://pay.${DOMAIN}`,
      config: { app_id: `2021004${digits(9)}`, private_key: `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ${b64ish(40)}`, public_key: `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA${b64ish(40)}`, product_name: '星云加速 会员服务' } }),
    PM({ payment: 'EPay', name: '微信支付', notify_domain: `https://pay.${DOMAIN}`, handling_fee_percent: '2.00',
      config: { url: 'https://epay.example.net', pid: '1024', key: randomChar(32), type: 'wxpay' } }),
    PM({ payment: 'Epusdt', name: 'USDT (TRC20)', notify_domain: `https://pay.${DOMAIN}`,
      config: { epusdt_url: 'https://usdt.example.net', epusdt_pid: '1001', epusdt_token: randomChar(32), epusdt_currency: 'cny', epusdt_asset: 'usdt', epusdt_network: 'tron' } }),
    PM({ payment: 'StripeCheckout', name: '信用卡 (Visa / Mastercard)', notify_domain: `https://pay2.${DOMAIN}/`, handling_fee_fixed: 100, handling_fee_percent: '3.50',
      config: { currency: 'usd', stripe_sk_live: `sk_live_${randomChar(24)}`, stripe_pk_live: `pk_live_${randomChar(24)}`, stripe_webhook_key: `whsec_${randomChar(32)}`, stripe_custom_field_name: '联系方式' } }),
    PM({ payment: 'EPay', name: 'QQ 钱包', enable: 0, config: { url: 'https://epay.example.net', pid: '1024', key: randomChar(32), type: 'qqpay' } }),
  ].map((p, i) => ({ id: i + 1, uuid: randomChar(8), ...p, sort: i + 1, created_at: NOW - (400 - i * 50) * DAY, updated_at: NOW - (40 - i * 5) * DAY }))

  /* ------------------------------ 优惠券 ------------------------------ */
  const couponDefs = [
    ['国庆特惠 8 折', 2, 20, [NOW - 5 * DAY, NOW + 14 * DAY], 500, 1, null, null],
    ['新人立减 5 元', 1, 500, [NOW - 120 * DAY, NOW + 240 * DAY], null, 1, null, ['month_price']],
    ['年付专享 7 折', 2, 30, [NOW - 30 * DAY, NOW + 60 * DAY], 200, 1, [3, 4, 5], ['year_price', 'two_year_price']],
    ['中秋团圆 85 折', 2, 15, [NOW - 20 * DAY, NOW - 6 * DAY], 300, 1, null, null],
    ['老用户回馈 立减 20 元', 1, 2000, [NOW - 10 * DAY, NOW + 50 * DAY], 100, 1, [3, 4], null],
    ['双十一预热 75 折', 2, 25, [NOW + 30 * DAY, NOW + 50 * DAY], 1000, 1, null, null],
    ['Telegram 群专属 9 折', 2, 10, [NOW - 60 * DAY, NOW + 120 * DAY], null, 1, null, null],
    ['Ultra 升级券 立减 15 元', 1, 1500, [NOW - 15 * DAY, NOW + 45 * DAY], 50, 1, [4], ['month_price', 'quarter_price']],
    ['推广渠道 A 88 折', 2, 12, [NOW - 90 * DAY, NOW + 90 * DAY], 1000, null, null, null],
    ['推广渠道 B 88 折', 2, 12, [NOW - 90 * DAY, NOW + 90 * DAY], 1000, null, null, null],
    ['618 年中大促', 2, 30, [NOW - 110 * DAY, NOW - 95 * DAY], 800, 1, null, ['year_price']],
    ['工单补偿券 10 元', 1, 1000, [NOW - 40 * DAY, NOW + 20 * DAY], 1, 1, null, null],
    ['游戏专线首月 半价', 2, 50, [NOW - 7 * DAY, NOW + 23 * DAY], 100, 1, [6], ['month_price']],
    ['流媒体版季付 立减 10 元', 1, 1000, [NOW - 25 * DAY, NOW + 35 * DAY], 200, 1, [5], ['quarter_price']],
    ['学生认证 85 折', 2, 15, [NOW - 200 * DAY, NOW + 165 * DAY], null, 1, [2, 3], null],
    ['春节限时 7 折', 2, 30, [NOW - 230 * DAY, NOW - 215 * DAY], 500, 1, null, null],
    ['KOL 合作 9 折', 2, 10, [NOW - 45 * DAY, NOW + 45 * DAY], 300, null, null, null],
    ['企业版首年 立减 200 元', 1, 20000, [NOW - 60 * DAY, NOW + 120 * DAY], 20, 1, [7], ['year_price']],
    ['周年庆 66 折', 2, 34, [NOW + 60 * DAY, NOW + 67 * DAY], 666, 1, null, null],
    ['测试券（勿用）', 1, 1, [NOW - 300 * DAY, NOW + 3000 * DAY], 5, 1, null, null],
    ['回流用户 立减 8 元', 1, 800, [NOW - 12 * DAY, NOW + 18 * DAY], null, 1, [2, 3, 4], null],
    ['季付 9 折', 2, 10, [NOW - 70 * DAY, NOW + 20 * DAY], null, 2, null, ['quarter_price']],
    ['Lite 首月 1 折体验', 2, 90, [NOW - 3 * DAY, NOW + 4 * DAY], 50, 1, [2], ['month_price']],
    ['邀请好友奖励 5 元', 1, 500, [NOW - 150 * DAY, NOW + 215 * DAY], null, 3, null, null],
  ]
  S.coupons = couponDefs.map(([name, type, value, [started, ended], limitUse, limitPerUser, planIds, periods], i) => {
    const created = Math.min(started, NOW) - ri(1, 5) * DAY
    return {
      id: i + 1,
      code: randomChar(8),
      name,
      type,
      value,
      show: name.includes('勿用') || ended < NOW - 30 * DAY ? 0 : 1,
      limit_use: limitUse,
      limit_use_with_user: limitPerUser,
      limit_plan_ids: planIds,
      limit_period: periods,
      started_at: dayStart(started),
      ended_at: dayStart(ended) + DAY - 1,
      created_at: created,
      updated_at: created + ri(0, 3) * DAY,
    }
  })

  /* ------------------------------ 礼品卡 ------------------------------ */
  const giftDefs = [
    ['余额卡 50 元', 1, 5000, null, 1],
    ['余额卡 100 元', 1, 10000, null, 1],
    ['余额卡 20 元（活动）', 1, 2000, null, 200],
    ['7 天时长卡', 2, 7, null, 1],
    ['30 天时长卡', 2, 30, null, 1],
    ['国庆 3 天时长福利', 2, 3, null, 500],
    ['100GB 流量卡', 3, 100, null, 1],
    ['50GB 流量卡（群福利）', 3, 50, null, 100],
    ['流量重置卡', 4, null, null, 1],
    ['流量重置卡（补偿）', 4, null, null, 20],
    ['月付 Pro 30 天体验卡', 5, 30, 3, 1],
    ['月付 Ultra 7 天体验卡', 5, 7, 4, 50],
    ['游戏专线 30 天卡', 5, 30, 6, 1],
    ['流媒体解锁版 30 天卡', 5, 30, 5, 1],
    ['余额卡 200 元', 1, 20000, null, 1],
    ['KOL 合作 Pro 14 天', 5, 14, 3, 300],
    ['20GB 流量卡', 3, 20, null, 1],
    ['时长补偿 1 天', 2, 1, null, 1000],
    ['年付企业版 365 天卡', 5, 365, 7, 1],
    ['余额卡 10 元（工单补偿）', 1, 1000, null, 1],
    ['中秋 5 天时长卡', 2, 5, null, 300],
    ['Lite 月卡', 5, 30, 2, 1],
  ]
  const normalUserIds = S.users.filter((u) => u.is_admin === 0 && u.is_staff === 0).map((u) => u.id)
  S.giftcards = giftDefs.map(([name, type, value, planId, limitUse], i) => {
    const created = NOW - ri(1, 120) * DAY - ri(0, DAY)
    const maxUsed = limitUse === 1 ? (chance(0.55) ? 1 : 0) : Math.min(limitUse, ri(0, 14))
    const usedIds = [...new Set(Array.from({ length: maxUsed }, () => pick(normalUserIds)))]
    return {
      id: i + 1,
      code: randomChar(16),
      name,
      type,
      value,
      plan_id: planId,
      limit_use: limitUse,
      used_user_ids: usedIds.length ? usedIds : null,
      started_at: dayStart(created),
      ended_at: dayStart(created) + ri(30, 365) * DAY - 1,
      created_at: created,
      updated_at: created + ri(0, 10) * DAY,
    }
  })

  /* ------------------------------ 订单 ------------------------------ */
  S.orders = []
  S.commissionLogs = []
  const planUsers = S.users.filter((u) => u.plan_id && u.plan_id !== 1 && !u.is_admin && !u.is_staff)
  const nonAdmin = S.users.filter((u) => !u.is_admin && !u.is_staff)
  const sellable = S.plans.filter((p) => p.id !== 8)
  const N_ORDERS = 58
  const drafts = []
  for (let i = 0; i < N_ORDERS; i++) {
    let created
    if (i < 6) created = Math.max(TODAY + 30, NOW - ri(60, 5 * 3600))
    else created = NOW - Math.round(((i - 5) / (N_ORDERS - 5)) ** 1.15 * 42 * DAY) - ri(600, 7200)
    let type = weighted([[1, 30], [2, 35], [3, 8], [4, 7], [9, 20]])
    let user = type === 1 || type === 9 ? pick(nonAdmin) : pick(planUsers)
    let plan = null
    let period
    if (type === 9) {
      period = 'deposit'
    } else {
      if (type === 3) plan = pick(sellable.filter((p) => p.id !== user.plan_id && p.id !== 1))
      else if (type === 1) plan = user.plan_id && user.plan_id !== 1 ? planById(user.plan_id) : pick(sellable)
      else plan = planById(user.plan_id)
      if (type === 4 && !plan.reset_price) type = 2
      if (type === 4) period = 'reset_price'
      else {
        const periods = PERIOD_KEYS.filter((k) => k !== 'reset_price' && plan[k] != null)
        period = weighted(periods.map((k) => [k, k === 'month_price' ? 6 : k === 'quarter_price' ? 3 : k === 'onetime_price' ? 4 : 1]))
      }
    }
    drafts.push({ created, type, user, plan, period })
  }
  drafts.sort((a, b) => a.created - b.created)
  drafts.forEach(({ created, type, user, plan, period }, idx) => {
    const id = idx + 1
    const price = type === 9 ? pick([5000, 10000, 10000, 20000, 30000, 50000]) : plan[period]
    let total = price
    let discount = null
    let couponId = null
    if (type !== 9 && type !== 4 && chance(0.22)) {
      const c = pick(S.coupons.filter((x) => x.show))
      couponId = c.id
      discount = c.type === 1 ? Math.min(c.value, total) : Math.round((total * c.value) / 100)
      total -= discount
    }
    let balanceAmount = null
    if (type !== 9 && chance(0.15)) {
      balanceAmount = Math.min(total, pick([368, 500, 1000, 1200, 2000]))
      total -= balanceAmount
    }
    let surplus = null
    if (type === 3) {
      surplus = Math.min(total, ri(8, 40) * 100)
      total -= surplus
    }
    const ageSec = NOW - created
    let status
    if (ageSec < 2 * 3600 && chance(0.55)) status = 0
    else if (ageSec >= 2 * 3600 && chance(0.12)) status = 2
    else status = 3
    const paid = status === 1 || status === 3
    const paymentId = total === 0 ? null : weighted([[1, 5], [2, 3], [3, 2], [4, 1]])
    const pay = S.payments.find((p) => p.id === paymentId)
    let handling = null
    if (pay && (pay.handling_fee_fixed || pay.handling_fee_percent)) {
      handling = Math.round((pay.handling_fee_fixed || 0) + (total * Number(pay.handling_fee_percent || 0)) / 100)
    }
    const paidAt = paid ? created + ri(20, 600) : null
    let callback = null
    if (paid) {
      if (!pay) callback = 'manual_operation'
      else if (pay.payment === 'AlipayF2F') callback = `${cst(paidAt).y}${pad(cst(paidAt).m)}${pad(cst(paidAt).d)}22001${digits(15)}`
      else if (pay.payment === 'EPay') callback = `${cst(paidAt).y}${pad(cst(paidAt).m)}${pad(cst(paidAt).d)}${digits(14)}`
      else if (pay.payment === 'Epusdt') callback = hex(64)
      else callback = `cs_live_${randomChar(40)}`
      if (chance(0.06)) callback = 'manual_operation'
    }
    const inviter = user.invite_user_id ? userById(user.invite_user_id) : null
    let commission = 0
    let commissionStatus = 0
    let actual = null
    if (inviter && type !== 9 && total > 0 && status !== 2) {
      const rate = inviter.commission_rate ?? S.config.invite.invite_commission
      commission = Math.round((total * rate) / 100)
      if (paid) {
        if (ageSec > 4 * DAY) commissionStatus = chance(0.85) ? 2 : 3
        else commissionStatus = chance(0.7) ? 0 : 1
      }
      if (commissionStatus === 2) actual = commission
    }
    const order = {
      id,
      invite_user_id: inviter ? inviter.id : null,
      user_id: user.id,
      plan_id: plan ? plan.id : 0,
      coupon_id: couponId,
      payment_id: paymentId,
      type,
      period,
      trade_no: orderNo(created),
      callback_no: callback,
      total_amount: total,
      handling_amount: handling,
      discount_amount: discount,
      surplus_amount: surplus,
      refund_amount: null,
      balance_amount: balanceAmount,
      surplus_order_ids: null,
      status,
      commission_status: commissionStatus,
      commission_balance: commission,
      actual_commission_balance: actual,
      paid_at: paidAt,
      created_at: created,
      updated_at: paidAt || created + (status === 2 ? 1800 : 0),
    }
    S.orders.push(order)
    if (commissionStatus === 2) {
      const at = paidAt + 3 * DAY + ri(0, 3600)
      S.commissionLogs.push({
        id: S.commissionLogs.length + 1,
        invite_user_id: inviter.id,
        user_id: user.id,
        trade_no: order.trade_no,
        order_amount: total,
        get_amount: commission,
        created_at: at,
        updated_at: at,
      })
    }
  })
  // 变更订阅（type=3）把同一用户更早的已完成订单标为「已折抵」
  for (const o of S.orders) {
    if (o.type !== 3) continue
    const older = S.orders.find((x) => x.user_id === o.user_id && x.id < o.id && x.status === 3 && x.type !== 9)
    if (older) {
      older.status = 4
      o.surplus_order_ids = [older.id]
    } else {
      o.surplus_order_ids = null
    }
    if (o.surplus_amount && o.status !== 2 && chance(0.4)) o.refund_amount = ri(1, 5) * 100
  }
  // 一张「开通中」的订单
  const opening = S.orders.filter((o) => o.status === 3 && NOW - o.created_at < DAY).pop()
  if (opening) opening.status = 1

  /* ------------------------------ 公告 ------------------------------ */
  const noticeDefs = [
    ['请勿分享订阅链接', ['重要', '安全'], 1, null,
      '近期发现部分用户将订阅链接公开分享，导致账号被大量陌生 IP 使用。\n\n- 系统会自动检测异常 IP 数量并封禁账号\n- 如订阅已泄露，请在「个人中心 → 重置订阅」中重置\n\n感谢大家的配合！'],
    ['国庆假期客服安排及节点扩容公告', ['重要'], 1, THEMES.default.images,
      '10 月 1 日 - 10 月 7 日期间客服响应时间调整为 10:00 - 22:00。\n\n为应对假期高峰，我们新增了 **香港 IPLC 03 / 日本 IPLC 04** 两条专线，Pro 及以上套餐可用。\n\n国庆特惠：全场 8 折，优惠码见 Telegram 频道。'],
    ['香港 IPLC 线路 9 月 28 日凌晨维护通知', ['维护'], 1, null,
      '维护时间：9 月 28 日 02:00 - 04:00（北京时间）\n\n影响范围：香港 IPLC 01 / 02\n\n维护期间请临时切换至「香港 HKT 01」或日本节点，给您带来的不便敬请谅解。'],
    ['新增 AnyTLS / Hysteria2 协议节点', ['更新'], 1, null,
      '新增 AnyTLS 与 Hysteria2 协议节点，弱网环境下表现更好。\n\n请将客户端升级到 **Clash Verge Rev 2.2+ / Mihomo 1.19+** 后更新订阅。旧版客户端会自动过滤不支持的节点。'],
    ['中秋特惠：年付套餐 7 折', ['活动'], 0, null,
      '中秋活动已结束，感谢大家的支持！\n\n未使用的优惠码已自动失效。'],
    ['关于近期部分地区 DNS 污染的说明', ['重要'], 1, null,
      '近期部分地区运营商 DNS 对订阅域名进行了污染，表现为「更新订阅失败」。\n\n解决办法：\n1. 使用备用订阅地址 sub2\n2. 或将系统 DNS 修改为 223.5.5.5 / 119.29.29.29'],
    ['邀请返利规则调整', ['通知'], 1, null,
      '自 9 月 1 日起，邀请返利比例由 10% 调整为 **15%**，且不再限制仅首单返利。\n\n佣金满 100 元即可提现至支付宝或 USDT。'],
    ['客户端推荐与下载', ['教程'], 1, null,
      '- Windows / macOS：Clash Verge Rev\n- iOS：Shadowrocket / Stash（需外区 Apple ID）\n- Android：Clash Meta for Android\n\n详细教程请查看「知识库」。'],
    ['8 月账单系统升级完成', ['通知'], 0, null,
      '账单系统已完成升级，支持 USDT (TRC20) 支付与余额抵扣。'],
  ]
  S.notices = noticeDefs.map(([title, tags, show, img, content], i) => {
    const created = NOW - Math.round((i * 11 + ri(0, 4)) * DAY) - ri(0, DAY)
    return { id: noticeDefs.length - i, title, content, show, img_url: img, tags, created_at: created, updated_at: created + ri(0, 2) * 3600 }
  })

  /* ------------------------------ 知识库 ------------------------------ */
  const kb = [
    ['新手入门', 'zh-CN', '快速开始：三分钟完成配置',
      '## 第一步：购买套餐\n\n在「商店」中选择适合的套餐，推荐新用户先购买「新人体验 3 天」。\n\n## 第二步：下载客户端\n\n根据设备下载对应客户端，见「客户端教程」分类。\n\n## 第三步：导入订阅\n\n在「仪表盘」点击「一键订阅」，选择对应客户端即可自动导入。'],
    ['新手入门', 'zh-CN', '如何获取和更新订阅链接',
      '订阅链接位于「仪表盘 → 一键订阅 → 复制订阅地址」。\n\n客户端中建议将订阅更新间隔设置为 **24 小时**。节点变动后手动点击「更新订阅」即可。\n\n> 订阅链接等同于账号密码，请勿分享给他人。'],
    ['新手入门', 'zh-CN', '套餐说明与流量计算规则',
      '- 流量按「上行 + 下行」合计，并乘以节点倍率\n- 例如在 1.5x 倍率的 IPLC 节点使用 10GB，实际扣除 15GB\n- 每月 1 号 00:00 重置已用流量（按购买日重置的套餐除外）'],
    ['客户端教程', 'zh-CN', 'Windows：Clash Verge Rev 使用教程',
      '1. 下载并安装 Clash Verge Rev\n2. 打开「订阅」页面，粘贴订阅地址后点击「导入」\n3. 在「代理」页面选择节点，推荐使用「自动选择」\n4. 在「设置」中开启「系统代理」\n\n需要游戏加速时请开启 **TUN 模式**。'],
    ['客户端教程', 'zh-CN', 'macOS：Clash Verge Rev 使用教程',
      'Apple Silicon 机型请下载 aarch64 版本，Intel 机型下载 x64 版本。\n\n首次打开如提示「无法验证开发者」，请在「系统设置 → 隐私与安全性」中点击「仍要打开」。'],
    ['客户端教程', 'zh-CN', 'iOS：Shadowrocket 使用教程',
      '1. 使用外区 Apple ID 在 App Store 购买 Shadowrocket\n2. 在网站「一键订阅」中选择「导入到 Shadowrocket」\n3. 打开 Shadowrocket，选择节点后打开右上角开关\n\n推荐开启「按需求连接」以节省电量。'],
    ['客户端教程', 'zh-CN', 'Android：Clash Meta for Android',
      '1. 下载 Clash Meta for Android（CMFA）\n2. 点击「配置 → 新配置 → URL」，粘贴订阅地址\n3. 返回首页点击「已停止」启动代理\n\n部分国产 ROM 需要在电池设置中允许后台运行。'],
    ['客户端教程', 'zh-CN', '路由器：OpenClash 配置',
      'OpenClash 需要 Meta 内核才能使用 Hysteria2 / AnyTLS 节点。\n\n订阅转换请选择「不转换」，直接使用 Clash 订阅格式。'],
    ['常见问题', 'zh-CN', '节点全部超时怎么办？',
      '请依次排查：\n\n1. 更新订阅（节点地址可能已变更）\n2. 检查电脑系统时间是否准确（误差需小于 90 秒）\n3. 切换网络（Wi-Fi / 4G）重试\n4. 仍无法解决请提交工单并附上客户端日志'],
    ['常见问题', 'zh-CN', '为什么提示设备数超限？',
      '系统统计的是 **近 10 分钟内** 使用订阅的不同 IP 数量。\n\n手机在 Wi-Fi 与 4G 之间切换会被计为 2 个 IP，属正常现象，等待 10 分钟后自动恢复。'],
    ['常见问题', 'zh-CN', 'Netflix / ChatGPT 解锁说明',
      '- Netflix：请使用「新加坡 流媒体解锁」节点（需流媒体解锁版或 Ultra 套餐）\n- ChatGPT：请使用「美国 圣何塞 ChatGPT 专用」节点\n\n如遇「unsupported country」，请清除浏览器缓存或使用无痕模式。'],
    ['账户与支付', 'zh-CN', '支付成功但订单未开通',
      '支付渠道回调偶尔有 1 - 5 分钟延迟，请稍后刷新订单页面。\n\n超过 10 分钟仍未开通，请提交工单并附上 **订单号** 与 **支付截图**，客服会人工核实处理。'],
    ['账户与支付', 'zh-CN', '邀请返利与佣金提现',
      '通过邀请链接注册的用户付款后，您可获得 15% 的佣金。\n\n- 佣金在订单完成 3 天后自动确认\n- 满 100 元可申请提现（支付宝 / USDT / Paypal）\n- 佣金也可以直接转入余额用于续费'],
    ['常见问题', 'en-US', 'How to import the subscription',
      'Copy the subscription URL from the dashboard, then import it in your client:\n\n- Clash Verge Rev: Profiles → paste URL → Import\n- Shadowrocket: tap + → Type: Subscribe → paste URL\n\nUpdate the subscription whenever nodes change.'],
  ]
  S.knowledge = kb.map(([category, language, title, body], i) => {
    const created = NOW - (400 - i * 20) * DAY
    return { id: i + 1, language, category, title, body, sort: i + 1, show: i === 7 ? 0 : 1, created_at: created, updated_at: NOW - ri(1, 90) * DAY }
  })

  /* ------------------------------ 节点 ------------------------------ */
  S.nodes = Object.fromEntries(PROTOCOLS.map((p) => [p, []]))
  S.runtime = {} // `${type}:${id}` → { online, last_check_at, last_push_at }

  function protocolFields(type, host, sni) {
    switch (type) {
      case 'shadowsocks':
        return { cipher: pick(['2022-blake3-aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305']), obfs: null, obfs_settings: null }
      case 'trojan': {
        const network = pick(['tcp', 'ws', 'grpc'])
        return {
          network,
          network_settings: network === 'ws' ? { path: '/trojan-ws', headers: { Host: host } } : network === 'grpc' ? { serviceName: 'trojan-grpc' } : null,
          server_name: sni,
          allow_insecure: 0,
        }
      }
      case 'vmess':
        return {
          tls: 1,
          network: 'ws',
          networkSettings: { path: `/${hex(8)}`, headers: { Host: sni } },
          tlsSettings: { serverName: sni, allowInsecure: '0' },
          ruleSettings: null,
          dnsSettings: null,
        }
      case 'tuic':
        return { server_name: sni, insecure: 0, disable_sni: 0, udp_relay_mode: 'native', congestion_control: 'bbr', zero_rtt_handshake: 0 }
      case 'anytls':
        return { server_name: sni, insecure: 0, padding_scheme: JSON.stringify(ANYTLS_PADDING) }
      case 'hysteria': {
        const obfs = chance(0.5)
        return { version: 2, up_mbps: pick([500, 1000]), down_mbps: pick([500, 1000]), obfs: obfs ? 'salamander' : null, obfs_password: obfs ? randomChar(16) : null, server_name: sni, insecure: 0 }
      }
      case 'vless':
        return {
          tls: 2,
          flow: 'xtls-rprx-vision',
          network: 'tcp',
          encryption: 'none',
          tls_settings: {
            server_name: pick(['www.microsoft.com', 'www.apple.com', 'gateway.icloud.com', 'www.yahoo.co.jp', 'www.samsung.com']),
            server_port: '443',
            public_key: b64ish(43),
            private_key: b64ish(43),
            short_id: hex(8),
            allow_insecure: '0',
          },
          network_settings: null,
          encryption_settings: null,
        }
      case 'v2node': {
        const protocol = pick(['vless', 'vless', 'trojan', 'hysteria2', 'anytls', 'shadowsocks'])
        const base = {
          protocol,
          listen_ip: '0.0.0.0',
          tls: 0,
          flow: null,
          network: 'tcp',
          encryption: null,
          cipher: null,
          up_mbps: null,
          down_mbps: null,
          obfs: null,
          obfs_password: null,
          disable_sni: 0,
          zero_rtt_handshake: 0,
          udp_relay_mode: null,
          congestion_control: null,
          tls_settings: null,
          network_settings: null,
          encryption_settings: null,
          padding_scheme: null,
        }
        if (protocol === 'vless') {
          Object.assign(base, {
            tls: 2,
            flow: 'xtls-rprx-vision',
            encryption: 'none',
            tls_settings: { server_name: 'www.microsoft.com', server_port: '443', public_key: b64ish(43), private_key: b64ish(43), short_id: hex(8) },
          })
        } else if (protocol === 'trojan') {
          Object.assign(base, { tls: 1, network: 'ws', tls_settings: { server_name: sni, allow_insecure: '0' }, network_settings: { path: '/ws', headers: { Host: sni } } })
        } else if (protocol === 'hysteria2') {
          Object.assign(base, { tls: 1, up_mbps: 1000, down_mbps: 1000, obfs: 'salamander', obfs_password: randomChar(16), tls_settings: { server_name: sni, allow_insecure: '0' } })
        } else if (protocol === 'anytls') {
          Object.assign(base, { tls: 1, tls_settings: { server_name: sni, allow_insecure: '0' }, padding_scheme: JSON.stringify(ANYTLS_PADDING) })
        } else {
          Object.assign(base, { cipher: '2022-blake3-aes-128-gcm' })
        }
        return base
      }
      default:
        return {}
    }
  }

  // [协议, 名称, 主机前缀, 权限组, 倍率, 标签, { 可选：port/server_port/parent/show/status }]
  const nodeDefs = [
    ['vless', '香港 IPLC 01', 'gz-iplc', [2, 3], '1.5', ['IPLC', '低延迟'], { port: '30001', server_port: 443, weight: 190 }],
    ['vless', '香港 IPLC 02', 'sz-iplc', [2, 3], '1.5', ['IPLC'], { port: '30002', server_port: 443, weight: 170 }],
    ['v2node', '香港 HKT 01', 'hk-hkt01', [1, 2, 3], '1', ['HKT', '原生IP'], { weight: 150 }],
    ['trojan', '香港 HKBN 02', 'hk-hkbn02', [1, 2], '1', null, { weight: 120 }],
    ['vmess', '台湾 Hinet 01', 'tw-hinet01', [1, 2, 3], '1', ['原生IP'], { weight: 80 }],
    ['shadowsocks', '日本 东京 01', 'jp-tyo01', [1, 2, 3], '1', null, { port: '8388', server_port: 8388, weight: 110 }],
    ['vless', '日本 东京 IPLC 02', 'sh-iplc', [3], '2', ['IPLC'], { port: '30012', server_port: 443, weight: 130 }],
    ['hysteria', '日本 大阪 Hy2 03', 'jp-osa03', [2, 3], '1', ['Hysteria2'], { port: '20000-40000', server_port: 443, weight: 70 }],
    ['trojan', '新加坡 01', 'sg01', [1, 2, 3], '1', null, { weight: 95 }],
    ['v2node', '新加坡 流媒体解锁', 'sg-unlock', [5], '1', ['Netflix', 'Disney+'], { weight: 85 }],
    ['tuic', '新加坡 TUIC 03', 'sg03', [2, 3], '1', null, { port: '8443', server_port: 8443, weight: 40 }],
    ['vmess', '韩国 首尔 01', 'kr-sel01', [1, 2], '1', null, { weight: 45 }],
    ['anytls', '美国 洛杉矶 CN2 GIA', 'us-lax-gia', [2, 3], '1', ['CN2 GIA'], { weight: 75 }],
    ['v2node', '美国 圣何塞 ChatGPT 专用', 'us-sjc-ai', [2, 3, 5], '1', ['ChatGPT', 'Claude'], { weight: 60 }],
    ['shadowsocks', '美国 西雅图 02', 'us-sea02', [1, 2], '0.8', null, { port: '8388', server_port: 8388, weight: 35 }],
    ['hysteria', '英国 伦敦 01', 'uk-lon01', [2, 3], '1', null, { port: '20000-40000', server_port: 443, weight: 25 }],
    ['trojan', '德国 法兰克福 01', 'de-fra01', [1, 2], '1', null, { weight: 22 }],
    ['vless', '土耳其 伊斯坦布尔 低价区', 'tr-ist01', [2], '0.5', ['低价区'], { weight: 18 }],
    ['anytls', '游戏专线 香港 01', 'hk-game01', [4], '2', ['游戏', 'UDP'], { weight: 55, status: 1 }],
    ['tuic', '游戏专线 日本 02', 'jp-game02', [4], '2', ['游戏'], { port: '8443', server_port: 8443, weight: 38 }],
    ['shadowsocks', '体验节点 香港', 'hk-trial', [6], '1', ['体验'], { port: '8388', server_port: 8388, weight: 12 }],
    ['vmess', '体验节点 日本', 'jp-trial', [6], '1', ['体验'], { weight: 9 }],
    ['v2node', '俄罗斯 莫斯科 01', 'ru-mow01', [2], '1.2', null, { weight: 8, status: 1 }],
    ['vless', '香港 IPLC 01 · 深圳入口', 'sz2-iplc', [2, 3], '1.5', ['IPLC'], { port: '30011', server_port: 443, parent: 'vless:1' }],
    ['trojan', '马来西亚 01', 'my01', [1, 2], '1', null, { weight: 14 }],
    ['hysteria', '澳大利亚 悉尼 01', 'au-syd01', [2, 3], '1.5', null, { port: '20000-40000', server_port: 443, weight: 11 }],
    ['vmess', '印度 孟买 01', 'in-bom01', [2], '1', null, { show: 0, status: 0 }],
    ['shadowsocks', '阿根廷 01（维护中）', 'ar01', [2], '1', ['维护'], { show: 0, status: 0, port: '8388', server_port: 8388 }],
  ]
  nodeDefs.forEach(([type, name, prefix, groupIds, rate, tags, opt], i) => {
    const list = S.nodes[type]
    const id = list.length + 1
    const host = `${prefix}.${DOMAIN}`
    const sni = `${prefix}.${DOMAIN}`
    const created = NOW - (420 - i * 12) * DAY
    let parentId = null
    if (opt.parent) parentId = Number(opt.parent.split(':')[1])
    const node = {
      id,
      group_id: groupIds,
      route_id: groupIds.includes(5) ? [2, 6, 9] : groupIds.includes(4) ? [1, 2, 9] : [1, 2, 3, 4, 5, 9],
      parent_id: parentId,
      tags,
      name,
      rate,
      host,
      port: opt.port ?? '443',
      server_port: opt.server_port ?? 443,
      ...protocolFields(type, host, sni),
      show: opt.show ?? 1,
      sort: i + 1,
      created_at: created,
      updated_at: NOW - ri(1, 60) * DAY,
    }
    list.push(node)
    const status = opt.status ?? 2
    S.runtime[`${type}:${id}`] = {
      weight: opt.weight ?? 10,
      online: status === 0 ? null : Math.max(1, Math.round((opt.weight ?? 10) * rf(0.25, 0.45))),
      last_check_at: status === 0 ? (chance(0.5) ? null : NOW - ri(2, 9) * DAY) : NOW - ri(5, 55),
      last_push_at: status === 0 ? null : status === 1 ? NOW - ri(900, 5400) : NOW - ri(5, 55),
    }
  })

  /* ------------------------------ 工单 ------------------------------ */
  const templates = [
    ['香港节点晚高峰延迟很高', 1, [
      'u:晚上 8 点到 11 点香港 IPLC 01 延迟从 30ms 跳到 200ms 以上，看视频一直卡，其他时间都正常。',
      'a:您好，已收到反馈。请问您所在地区和宽带运营商是？方便的话提供一下 tracert 结果截图。',
      'u:上海电信 500M，截图已经上传：https://img.example.net/tr.png',
      'a:感谢提供。排查发现该线路上游晚高峰拥塞，已临时切到备用中转，您今晚再测试看看。',
      'u:今晚好多了，谢谢！']],
    ['支付成功但订单一直显示待支付', 2, [
      'u:用支付宝付了 25 元，钱已经扣了，但订单还是待支付，订单号在截图里。',
      'a:您好，支付宝回调有延迟，我们已人工核实到账并为您开通，请刷新页面查看。',
      'u:好的，已经可以用了。']],
    ['申请退款', 1, [
      'u:买错套餐了，本来想买季付买成了月付，刚买 10 分钟还没用过，可以退吗？',
      'a:您好，未使用流量的订单可以为您折算到余额，余额可用于购买其他套餐。已为您操作，请查看账户余额。']],
    ['Netflix 显示代理错误', 0, [
      'u:用新加坡流媒体解锁节点看 Netflix，提示「您似乎在使用解锁器或代理」。',
      'a:您好，请确认客户端分流规则中 Netflix 走的是「新加坡 流媒体解锁」节点，并清除 Netflix App 缓存后重试。',
      'u:还是不行，只能看自制剧。',
      'a:已为该节点更换解锁 IP，预计 10 分钟生效，请稍后再试。']],
    ['订阅链接导入 Clash Verge 报错', 1, [
      'u:导入订阅提示「yaml: unmarshal errors」，昨天还是好的。',
      'a:您好，这是客户端内核过旧不支持新协议导致的，请升级到 Clash Verge Rev 最新版后重新导入。']],
    ['续费后流量没有重置', 1, [
      'u:今天续费了月付 Pro，但已用流量还是上个月的 280G，没有清零。',
      'a:您好，续费只延长到期时间，流量按套餐的重置周期（每月 1 号）清零。如需立即重置可购买流量重置包。',
      'u:明白了，那我买个重置包。']],
    ['提示设备数超限', 0, [
      'u:只有手机和电脑两台设备，却提示在线设备超过限制。',
      'a:您好，系统统计的是近 10 分钟内的 IP 数，Wi-Fi 与 4G 切换会被计为两个 IP。等待 10 分钟即可恢复。']],
    ['能否开具发票', 0, [
      'u:公司报销需要发票，请问可以开吗？',
      'a:您好，抱歉目前暂不支持开具发票。']],
    ['邀请佣金什么时候可以提现', 0, [
      'u:邀请了 3 个朋友，佣金显示待确认，什么时候能提现？',
      'a:您好，佣金在订单完成 3 天后自动确认，确认后满 100 元即可申请提现到支付宝或 USDT。']],
    ['iOS 用什么客户端比较好', 0, [
      'u:国区 Apple ID 下载不到 Shadowrocket，有推荐吗？',
      'a:您好，可使用外区 Apple ID 购买 Shadowrocket 或 Stash，详见知识库「iOS：Shadowrocket 使用教程」。']],
    ['ChatGPT 提示 unsupported country', 1, [
      'u:用美国节点打开 ChatGPT 提示不支持所在地区。',
      'a:您好，请使用「美国 圣何塞 ChatGPT 专用」节点，并在无痕模式下重新登录。']],
    ['游戏专线 UDP 不通', 2, [
      'u:用游戏专线玩 APEX 一直连不上服务器，TCP 测速是正常的。',
      'a:您好，请确认客户端开启了 UDP 转发（Clash 需开启 TUN 模式）。',
      'u:开了 TUN 还是不行。',
      'a:排查到该节点 UDP 端口被上游限制，已修复，请重新测试。',
      'u:可以了，延迟 60ms 左右，感谢。']],
    ['账号被封禁了', 2, [
      'u:为什么我的账号突然被封了？我没有违规操作。',
      'a:您好，系统检测到您的订阅在短时间内被 30 多个不同 IP 使用，疑似分享订阅。已为您重置订阅地址并解封，请勿再分享。']],
    ['想更换注册邮箱', 0, [
      'u:原来的邮箱不用了，想换成 Gmail，可以吗？',
      'a:您好，请回复新的邮箱地址，我们会为您修改。',
      'u:新邮箱已经发在上面了，麻烦了。']],
    ['USDT 付款金额和套餐价格不一致', 1, [
      'u:用 USDT 付款时显示的金额比套餐价格高一点？',
      'a:您好，USDT 支付按实时汇率换算并包含链上手续费，属于正常现象。']],
    ['所有节点都超时', 2, [
      'u:今天早上开始所有节点都超时，是出什么问题了吗？',
      'a:您好，今早 DNS 服务商故障导致部分域名解析失败，现已恢复。请在客户端中更新订阅后重试。',
      'u:更新订阅后好了。']],
    ['安卓手机耗电很快', 0, [
      'u:开着 Clash Meta 手机一天掉电特别快，有什么设置可以优化吗？']],
    ['流量消耗异常', 1, [
      'u:这两天什么都没干，流量却用了 50G。',
      'a:您好，请检查是否有设备在后台下载或同步（如 iCloud、Steam 更新），流量明细可在「流量明细」页面查看。']],
  ]
  S.tickets = []
  S.messages = []
  const N_TICKETS = 24
  const ticketUsers = S.users.filter((u) => !u.is_admin && !u.is_staff)
  for (let i = 0; i < N_TICKETS; i++) {
    const [subject, level, script] = templates[i % templates.length]
    const user = ticketUsers[(i * 7 + 3) % ticketUsers.length]
    // i 小 = 越新；前 7 张待回复，接下来 7 张已回复，其余已关闭
    const kind = i < 7 ? 'pending' : i < 14 ? 'replied' : 'closed'
    let lines = [...script]
    if (kind === 'pending') {
      while (lines.length > 1 && lines[lines.length - 1].startsWith('a:')) lines.pop()
    } else if (kind === 'replied') {
      while (lines.length > 1 && lines[lines.length - 1].startsWith('u:')) lines.pop()
      if (lines[lines.length - 1].startsWith('u:')) lines.push('a:您好，已收到您的反馈，技术同事正在排查，有进展会第一时间回复您。')
    }
    const created = NOW - Math.round((i ** 1.35) * 0.9 * DAY) - ri(1800, 5 * 3600)
    const ticketId = N_TICKETS - i
    let t = created
    lines.forEach((line, k) => {
      if (k > 0) t = Math.min(NOW - 60, t + ri(300, 5 * 3600))
      const fromAdmin = line.startsWith('a:')
      S.messages.push({
        id: 0,
        user_id: fromAdmin ? pick([1, 2]) : user.id,
        ticket_id: ticketId,
        message: line.slice(2),
        created_at: t,
        updated_at: t,
      })
    })
    S.tickets.push({
      id: ticketId,
      user_id: user.id,
      subject,
      level,
      status: kind === 'closed' ? 1 : 0,
      reply_status: kind === 'pending' ? 0 : 1,
      created_at: created,
      updated_at: kind === 'closed' ? t + ri(600, DAY) : t,
    })
  }
  S.messages.sort((a, b) => a.created_at - b.created_at || a.ticket_id - b.ticket_id)
  S.messages.forEach((m, i) => (m.id = i + 1))

  /* ------------------------------ 系统日志 ------------------------------ */
  const alipayUuid = S.payments[0].uuid
  const epayUuid = S.payments[1].uuid
  const logDefs = [
    ['error', 'SQLSTATE[HY000] [2002] Connection refused', 'POST', `/api/v1/guest/payment/notify/EPay/${epayUuid}`, { trade_no: '2026092414091300000012345', out_trade_no: '...', trade_status: 'TRADE_SUCCESS' }],
    ['error', 'cURL error 28: Operation timed out after 30001 milliseconds with 0 bytes received', 'GET', '/api/v1/server/UniProxy/user', { node_id: '3', node_type: 'v2node' }],
    ['warning', '支付回调签名校验失败', 'POST', `/api/v1/guest/payment/notify/AlipayF2F/${alipayUuid}`, { notify_type: 'trade_status_sync', sign_type: 'RSA2' }],
    ['error', 'Undefined array key "PHP_SELF"', 'POST', `${ADMIN_PREFIX}/config/save`, { app_name: '星云加速' }],
    ['error', 'Connection could not be established with host "ssl://smtp.exmail.qq.com:465": stream_socket_client(): Unable to connect', 'POST', '/api/v1/passport/comm/sendEmailVerify', { email: 'user@example.com' }],
    ['warning', 'Too Many Attempts.', 'POST', '/api/v1/passport/auth/login', { email: 'user@example.com' }],
    ['info', '管理员手动将订单标记为已支付', 'POST', `${ADMIN_PREFIX}/order/paid`, { trade_no: '2026092315092700000067890' }],
    ['error', 'Telegram API error: Bad Request: chat not found', 'POST', '/api/v1/guest/telegram/webhook', { update_id: 918273645 }],
    ['warning', 'Redis connection timed out, retrying (1/3)', 'GET', '/api/v1/client/subscribe', { token: '***' }],
    ['error', 'Call to a member function update() on null', 'POST', `${ADMIN_PREFIX}/server/manage/sort`, { vless: { 99: 1 } }],
    ['info', '节点上报流量', 'POST', '/api/v1/server/UniProxy/push', { node_id: '1', node_type: 'vless', users: 128 }],
    ['error', 'Allowed memory size of 134217728 bytes exhausted (tried to allocate 20480 bytes)', 'POST', `${ADMIN_PREFIX}/user/dumpCSV`, { filter: [] }],
    ['warning', 'Stripe webhook signature verification failed', 'POST', `/api/v1/guest/payment/notify/StripeCheckout/${S.payments[3].uuid}`, { type: 'checkout.session.completed' }],
    ['info', '定时任务 v2board:statistics 执行完成', 'GET', 'artisan', null],
    ['error', 'Class "App\\Payments\\PaytaroQR" not found', 'POST', `${ADMIN_PREFIX}/payment/getPaymentForm`, { payment: 'PaytaroQR' }],
  ]
  S.logs = []
  const N_LOGS = 46
  for (let i = 0; i < N_LOGS; i++) {
    const [level, title, method, uri, data] = logDefs[weighted(logDefs.map((_, k) => [k, k < 6 ? 3 : 1]))]
    const created = NOW - Math.round((i ** 1.4) * 0.35 * 3600) - ri(30, 1500)
    S.logs.push({
      id: 0,
      title,
      level,
      host: `www.${DOMAIN}`,
      uri,
      method,
      data: data ? JSON.stringify(data) : null,
      ip: uri === 'artisan' ? null : randomIp(),
      context:
        level === 'error'
          ? `#0 /www/wwwroot/v2board/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183)\n#1 /www/wwwroot/v2board/app/Http/Middleware/Admin.php(28)\n#2 {main}`
          : null,
      created_at: created,
      updated_at: created,
    })
  }
  S.logs.sort((a, b) => a.created_at - b.created_at)
  S.logs.forEach((l, i) => (l.id = 3800 + i + 1))

  /* ------------------------------ 主题配置 ------------------------------ */
  S.themeConfigs = {
    default: {
      theme_color: 'darkblue',
      background_url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=2160&q=80',
      theme_sidebar: 'light',
      theme_header: 'dark',
      custom_html: '<!-- Crisp 客服 -->\n<script>window.$crisp=[];window.CRISP_WEBSITE_ID="00000000-0000-0000-0000-000000000000";</script>',
    },
    nebula: {
      theme_color: 'purple',
      hero_title: '连接世界，从未如此简单',
      hero_subtitle: 'IPLC 专线 · 流媒体解锁 · 7x24 工单支持',
      background_url: '',
      notice_popup: 1,
      show_invite: 1,
      default_locale: 'zh-CN',
      crisp_id: '',
      custom_html: '',
    },
  }

  /* ------------------------------ 统计序列（独立随机源，改别的数据不影响图表） ------------------------------ */
  const sr = mulberry32(777)
  S.series = []
  for (let k = 62; k >= 1; k--) {
    const ts = TODAY - k * DAY
    const idx = 62 - k
    const dow = cst(ts).dow
    const weekend = dow === 0 || dow === 6 ? 1.2 : dow === 5 ? 1.08 : 1
    const growth = 1 + idx * 0.011
    const promo = k >= 8 && k <= 10 ? 1.85 : k === 7 || k === 11 ? 1.3 : 1 // 中秋活动
    const noise = () => 0.88 + sr() * 0.24
    const paid_count = Math.round(36 * weekend * growth * promo * noise())
    const paid_total = Math.round(paid_count * (2700 + sr() * 800))
    const register_count = Math.round(6.2 * weekend * growth * (promo > 1 ? 1.7 : 1) * noise())
    const commission_count = Math.max(1, Math.round(paid_count * (0.1 + sr() * 0.06)))
    const commission_total = Math.round(paid_total * (0.06 + sr() * 0.03))
    S.series.push({ record_at: ts, register_count, paid_count, paid_total, commission_count, commission_total })
  }

  return S
}

let S = buildState()

/* ================================================================== *
 * 输出整形
 * ================================================================== */

const planName = (id) => S.plans.find((p) => p.id === id)?.name

function subscribeUrl(token) {
  const base = String(S.config.site.subscribe_url || '').split(',')[0] || S.config.site.app_url
  return `${base}${S.config.site.subscribe_path || '/api/v1/client/subscribe'}?token=${token}`
}

function userListRow(u) {
  const row = { ...u, total_used: u.u + u.d }
  const name = planName(u.plan_id)
  if (name) row.plan_name = name
  row.alive_ip = S.alive[u.id]?.alive_ip ?? 0
  row.ips = S.alive[u.id]?.ips ?? ''
  row.subscribe_url = subscribeUrl(u.token)
  return row
}

function orderRow(o) {
  const row = { ...o }
  const name = planName(o.plan_id)
  if (name) row.plan_name = name
  return row
}

function giftcardRow(g) {
  if (STRICT) return { ...g }
  return { ...g, used_user_ids: g.used_user_ids ? JSON.stringify(g.used_user_ids) : null }
}

function paymentRow(p) {
  const domain = String(p.notify_domain || '').replace(/\/+$/, '')
  return { ...p, notify_url: domain ? `${domain}/api/v1/guest/payment/notify/${p.payment}/${p.uuid}` : null }
}

function allNodes() {
  const out = []
  for (const type of PROTOCOLS) {
    for (const n of S.nodes[type]) {
      const row = { ...n, type }
      if (type === 'v2node') {
        row.install_command = `wget -N https://raw.githubusercontent.com/wyx2685/v2node/master/script/install.sh && bash install.sh --api-host '${S.config.server.server_api_url}' --node-id ${n.id} --api-key '${S.config.server.server_token}'`
      }
      const rt = S.runtime[`${type}:${n.parent_id ?? n.id}`] || {}
      row.online = rt.online ?? null
      row.last_check_at = rt.last_check_at ?? null
      row.last_push_at = rt.last_push_at ?? null
      const t = NOW - 300
      row.available_status = t >= (row.last_check_at ?? 0) ? 0 : t >= (row.last_push_at ?? 0) ? 1 : 2
      out.push(row)
    }
  }
  return sortBy(out, 'sort', 'ASC')
}

/* ================================================================== *
 * 过滤
 * ================================================================== */

function filterUsers(input) {
  let rows = S.users
  for (const f of readFilters(input)) {
    try {
      const key = String(f.key)
      const cond = String(f.condition ?? '=')
      let value = f.value
      if (key === 'invite_by_email') {
        const inviter = S.users.find((u) => compare(u.email, cond, value))
        const id = inviter ? inviter.id : 0
        rows = rows.filter((u) => u.invite_user_id === id)
        continue
      }
      if (key === 'plan_id' && value === 'null') {
        rows = rows.filter((u) => u.plan_id == null)
        continue
      }
      if (key === 'd' || key === 'transfer_enable') value = Number(value) * GiB
      rows = rows.filter((u) => compare(u[key], cond, value))
    } catch {
      // 过滤写坏了就当没有，不崩
    }
  }
  return rows
}

function filterOrders(input) {
  let rows = S.orders
  if (int(input.is_commission)) {
    rows = rows.filter((o) => o.invite_user_id != null && ![0, 2].includes(o.status) && o.commission_balance > 0)
  }
  for (const f of readFilters(input)) {
    try {
      const key = String(f.key)
      // 真实后端的 email 过滤是坏的（= 去匹配 %x%），查不到就静默忽略
      if (key === 'email') continue
      rows = rows.filter((o) => compare(o[key], String(f.condition ?? '='), f.value))
    } catch {
      // ignore
    }
  }
  return rows
}

/* ================================================================== *
 * CSV
 * ================================================================== */

const BOM = String.fromCharCode(0xfeff)
/** PHP echo 浮点数用 precision=14 */
const phpFloat = (x) => String(Number(Number(x).toPrecision(14)))

function usersCsv(rows) {
  let data = '邮箱,余额,推广佣金,总流量,设备数限制,剩余流量,套餐到期时间,订阅计划,订阅地址\r\n'
  for (const u of rows) {
    const expire = u.expired_at === null ? '长期有效' : phpDate(u.expired_at)
    const transfer = u.transfer_enable ? u.transfer_enable / GiB : 0
    // 真实后端这里读的是拼错的 devce_limit，所以这一列永远是空的 —— 照抄
    const deviceLimit = ''
    const left = (u.transfer_enable - (u.u + u.d)) / GiB
    const plan = planName(u.plan_id) ?? '无订阅'
    data += `${u.email},${phpFloat(u.balance / 100)},${phpFloat(u.commission_balance / 100)},${phpFloat(transfer)}, ${deviceLimit}, ${phpFloat(left)},${expire},${plan},${subscribeUrl(u.token)}\r\n`
  }
  return BOM + data
}

/* ================================================================== *
 * 管理接口
 * ================================================================== */

const R = new Map()
const route = (path, fn) => R.set(path, fn)
const OK = { data: true }

/* ------------------------------ config ------------------------------ */

route('/config/fetch', (input) => {
  const key = input.key
  if (key && S.config[key]) return { data: { [key]: S.config[key] } }
  return { data: S.config }
})
route('/config/save', (input) => {
  for (const [k, v] of Object.entries(input)) {
    if (k === 'auth_data') continue
    const group = Object.values(S.config).find((g) => has(g, k))
    if (group) group[k] = v
    else if (has(S.writeOnlyConfig, k)) S.writeOnlyConfig[k] = v
  }
  return OK
})
route('/config/getEmailTemplate', () => ({ data: ['classic', 'default', 'diy', 'site1', 'site2', 'site3'] }))
route('/config/getThemeTemplate', () => ({ data: Object.keys(THEMES) }))
route('/config/setTelegramWebhook', (input) => {
  if (!input.telegram_bot_token) abort(500, 'Telegram API error: Not Found')
  return OK
})
route('/config/testSendMail', () => ({
  data: true,
  log: {
    email: `admin@${DOMAIN}`,
    subject: 'This is v2board test email',
    template_name: 'notify',
    error: null,
  },
}))

/* ------------------------------ plan ------------------------------ */

function planCounts() {
  const counts = {}
  for (const u of S.users) {
    if (u.plan_id && (u.expired_at === null || u.expired_at > NOW)) counts[u.plan_id] = (counts[u.plan_id] || 0) + 1
  }
  return counts
}
route('/plan/fetch', () => {
  const counts = planCounts()
  return { data: sortBy(S.plans, 'sort').map((p) => ({ ...p, count: counts[p.id] || 0 })) }
})
const PLAN_FIELDS = ['name', 'group_id', 'transfer_enable', 'content', 'device_limit', 'speed_limit', ...PERIOD_KEYS, 'reset_traffic_method', 'capacity_limit']
const PLAN_NUMERIC = new Set(['group_id', 'transfer_enable', 'device_limit', 'speed_limit', ...PERIOD_KEYS, 'reset_traffic_method', 'capacity_limit'])
function pickPlanFields(input) {
  const out = {}
  for (const k of PLAN_FIELDS) {
    if (!has(input, k)) continue
    out[k] = PLAN_NUMERIC.has(k) ? numOrNull(input[k]) : input[k] ?? null
  }
  return out
}
route('/plan/save', (input) => {
  if (!input.name) validation('name', '套餐名称不能为空')
  const fields = pickPlanFields(input)
  if (input.id) {
    const plan = S.plans.find((p) => p.id === int(input.id))
    if (!plan) abort(500, '该订阅不存在')
    Object.assign(plan, fields, { updated_at: NOW })
    if (int(input.force_update)) {
      for (const u of S.users) {
        if (u.plan_id !== plan.id) continue
        u.group_id = plan.group_id
        u.transfer_enable = (plan.transfer_enable || 0) * GiB
        u.device_limit = plan.device_limit
        u.speed_limit = plan.speed_limit
      }
    }
    return OK
  }
  const plan = {
    id: nextId(S.plans),
    group_id: 1,
    transfer_enable: 0,
    content: null,
    device_limit: null,
    speed_limit: null,
    show: 0,
    renew: 1,
    sort: null,
    ...Object.fromEntries(PERIOD_KEYS.map((k) => [k, null])),
    reset_traffic_method: null,
    capacity_limit: null,
    ...fields,
    created_at: NOW,
    updated_at: NOW,
  }
  S.plans.push(plan)
  return OK
})
route('/plan/drop', (input) => {
  const id = int(input.id)
  if (S.orders.some((o) => o.plan_id === id)) abort(500, '该订阅下存在订单无法删除')
  if (S.users.some((u) => u.plan_id === id)) abort(500, '该订阅下存在用户无法删除')
  const idx = S.plans.findIndex((p) => p.id === id)
  if (idx < 0) abort(500, '该订阅ID不存在')
  S.plans.splice(idx, 1)
  return OK
})
route('/plan/update', (input) => {
  const plan = S.plans.find((p) => p.id === int(input.id))
  if (!plan) abort(500, '该订阅不存在')
  if (has(input, 'show')) plan.show = int(input.show, 0) ? 1 : 0
  if (has(input, 'renew')) plan.renew = int(input.renew, 0) ? 1 : 0
  plan.updated_at = NOW
  return OK
})
route('/plan/sort', (input) => {
  asList(input.plan_ids).forEach((id, i) => {
    const plan = S.plans.find((p) => p.id === int(id))
    if (plan) plan.sort = i + 1
  })
  return OK
})

/* ------------------------------ server group / route / manage ------------------------------ */

route('/server/group/fetch', (input) => {
  if (input.group_id) return { data: [S.groups.find((g) => g.id === int(input.group_id)) ?? null] }
  const nodes = allNodes()
  return {
    data: S.groups.map((g) => ({
      ...g,
      user_count: S.users.filter((u) => u.group_id === g.id).length,
      server_count: nodes.filter((n) => asList(n.group_id).map(Number).includes(g.id)).length,
    })),
  }
})
route('/server/group/save', (input) => {
  if (!input.name) abort(500, '组名不能为空')
  if (input.id) {
    const g = S.groups.find((x) => x.id === int(input.id))
    if (!g) abort(500, 'Attempt to assign property "name" on null')
    g.name = String(input.name)
    g.updated_at = NOW
  } else {
    S.groups.push({ id: nextId(S.groups), name: String(input.name), created_at: NOW, updated_at: NOW })
  }
  return OK
})
route('/server/group/drop', (input) => {
  const id = int(input.id)
  const idx = S.groups.findIndex((g) => g.id === id)
  if (idx < 0) abort(500, '组不存在')
  if ([...S.nodes.vmess, ...S.nodes.vless].some((n) => asList(n.group_id).map(Number).includes(id))) abort(500, '该组已被节点所使用，无法删除')
  if (S.plans.some((p) => p.group_id === id)) abort(500, '该组已被订阅所使用，无法删除')
  if (S.users.some((u) => u.group_id === id)) abort(500, '该组已被用户所使用，无法删除')
  S.groups.splice(idx, 1)
  return OK
})

route('/server/route/fetch', () => ({ data: S.routes.map((r) => ({ ...r })) }))
const ROUTE_ACTIONS = ['block', 'block_ip', 'block_port', 'protocol', 'dns', 'route', 'route_ip', 'default_out']
route('/server/route/save', (input) => {
  if (!input.remarks) validation('remarks', '备注不能为空')
  if (!ROUTE_ACTIONS.includes(input.action)) validation('action', '动作类型参数有误')
  const match = input.action === 'default_out' ? [] : asList(input.match).filter((x) => x !== '' && x != null).map(String)
  if (input.action !== 'default_out' && match.length === 0) validation('match', '匹配值不能为空')
  const fields = { remarks: String(input.remarks), match, action: input.action, action_value: input.action_value ?? null }
  if (input.id) {
    const r = S.routes.find((x) => x.id === int(input.id))
    if (!r) abort(500, '保存失败')
    Object.assign(r, fields, { updated_at: NOW })
  } else {
    S.routes.push({ id: nextId(S.routes), ...fields, created_at: NOW, updated_at: NOW })
  }
  return OK
})
route('/server/route/drop', (input) => {
  const idx = S.routes.findIndex((r) => r.id === int(input.id))
  if (idx < 0) abort(500, '路由不存在')
  S.routes.splice(idx, 1)
  return OK
})

route('/server/manage/getNodes', () => ({ data: allNodes() }))
route('/server/manage/sort', (input) => {
  for (const type of PROTOCOLS) {
    for (const [id, sort] of asEntries(input[type])) {
      const node = S.nodes[type].find((n) => n.id === int(id))
      if (!node) abort(500, 'Call to a member function update() on null')
      node.sort = int(sort)
    }
  }
  return OK
})

/* 8 协议 × save/drop/update/copy */
const NODE_ARRAY_FIELDS = ['group_id', 'route_id', 'tags']
function normalizeNodeInput(input) {
  const out = {}
  for (const [k, v] of Object.entries(input)) {
    if (k === 'id' || k === 'auth_data' || k === 'type') continue
    if (NODE_ARRAY_FIELDS.includes(k)) {
      const list = asList(v)
      out[k] = k === 'tags' ? (list.length ? list.map(String) : null) : list.length ? list.map((x) => (Number.isFinite(Number(x)) ? Number(x) : x)) : k === 'route_id' ? null : []
    } else if (k === 'port') out[k] = String(v)
    else if (k === 'rate') out[k] = String(v)
    else if (['server_port', 'parent_id', 'show', 'sort'].includes(k)) out[k] = int(v)
    else out[k] = v
  }
  return out
}
for (const type of PROTOCOLS) {
  const list = () => S.nodes[type]
  const find = (id) => list().find((n) => n.id === int(id))
  route(`/server/${type}/save`, (input) => {
    if (!input.name) validation('name', '节点名称不能为空')
    if (!asList(input.group_id).length) validation('group_id', '权限组不能为空')
    if (!input.host) validation('host', '节点地址不能为空')
    if (input.port === undefined || input.port === '') validation('port', '连接端口不能为空')
    if (input.rate === undefined || input.rate === '') validation('rate', '倍率不能为空')
    const fields = normalizeNodeInput(input)
    if (input.id) {
      const node = find(input.id)
      if (!node) abort(500, '服务器不存在')
      Object.assign(node, fields, { updated_at: NOW })
      return OK
    }
    list().push({ id: nextId(list()), parent_id: null, route_id: null, tags: null, show: 0, sort: null, ...fields, created_at: NOW, updated_at: NOW })
    return OK
  })
  route(`/server/${type}/drop`, (input) => {
    const idx = list().findIndex((n) => n.id === int(input.id))
    if (idx < 0) abort(500, '节点ID不存在')
    list().splice(idx, 1)
    return OK
  })
  route(`/server/${type}/update`, (input) => {
    const node = find(input.id)
    if (!node) abort(500, '该服务器不存在')
    node.show = int(input.show, 0) ? 1 : 0
    node.updated_at = NOW
    return OK
  })
  route(`/server/${type}/copy`, (input) => {
    const node = find(input.id)
    // 真实后端先给 null 赋 show 再判空，所以不存在的 id 是 PHP 错误而不是「服务器不存在」
    if (!node) abort(500, 'Attempt to assign property "show" on null')
    list().push({ ...structuredClone(node), id: nextId(list()), show: 0, created_at: NOW, updated_at: NOW })
    return OK
  })
}

/* ------------------------------ order ------------------------------ */

route('/order/fetch', (input) => {
  const rows = sortBy(filterOrders(input), 'created_at', 'DESC')
  const page = paginate(rows, input)
  return { data: page.data.map(orderRow), total: page.total }
})
route('/order/detail', (input) => {
  const order = S.orders.find((o) => o.id === int(input.id))
  if (!order) abort(500, '订单不存在')
  const data = STRICT ? { ...order } : orderRow(order)
  data.commission_log = S.commissionLogs.filter((c) => c.trade_no === order.trade_no)
  if (order.surplus_order_ids && order.surplus_order_ids.length) {
    data.surplus_orders = S.orders.filter((o) => order.surplus_order_ids.includes(o.id)).map((o) => ({ ...o }))
  }
  return { data }
})
const findOrderByTradeNo = (tradeNo) => {
  const order = S.orders.find((o) => o.trade_no === String(tradeNo ?? ''))
  if (!order) abort(500, '订单不存在')
  return order
}
route('/order/paid', (input) => {
  const order = findOrderByTradeNo(input.trade_no)
  if (order.status !== 0) abort(500, '只能对待支付的订单进行操作')
  order.status = 3
  order.paid_at = NOW
  order.callback_no = 'manual_operation'
  order.updated_at = NOW
  return OK
})
route('/order/cancel', (input) => {
  const order = findOrderByTradeNo(input.trade_no)
  if (order.status !== 0) abort(500, '只能对待支付的订单进行操作')
  order.status = 2
  order.updated_at = NOW
  if (order.balance_amount) {
    const user = S.users.find((u) => u.id === order.user_id)
    if (user) user.balance += order.balance_amount
  }
  return OK
})
route('/order/update', (input) => {
  const order = findOrderByTradeNo(input.trade_no)
  if (has(input, 'commission_status')) {
    const v = int(input.commission_status)
    if (![0, 1, 3].includes(v)) validation('commission_status', '佣金状态格式不正确')
    order.commission_status = v
  }
  order.updated_at = NOW
  return OK
})
route('/order/assign', (input) => {
  const plan = S.plans.find((p) => p.id === int(input.plan_id))
  const user = S.users.find((u) => u.email === input.email)
  if (!user) abort(500, '该用户不存在')
  if (!plan) abort(500, '该订阅不存在')
  if (!PERIOD_KEYS.includes(input.period)) validation('period', '订阅周期格式有误')
  if (S.orders.some((o) => o.user_id === user.id && [0, 1].includes(o.status))) abort(500, '该用户还有待支付的订单，无法分配')
  let type = 1
  if (input.period === 'reset_price') type = 4
  else if (user.plan_id !== null && plan.id !== user.plan_id) type = 3
  else if (user.expired_at > NOW && plan.id === user.plan_id) type = 2
  const inviter = user.invite_user_id ? S.users.find((u) => u.id === user.invite_user_id) : null
  const total = int(input.total_amount, 0)
  const order = {
    id: nextId(S.orders),
    invite_user_id: inviter ? inviter.id : null,
    user_id: user.id,
    plan_id: plan.id,
    coupon_id: null,
    payment_id: null,
    type,
    period: input.period,
    trade_no: guid(),
    callback_no: null,
    total_amount: total,
    handling_amount: null,
    discount_amount: null,
    surplus_amount: null,
    refund_amount: null,
    balance_amount: null,
    surplus_order_ids: null,
    status: 0,
    commission_status: 0,
    commission_balance: inviter ? Math.round((total * (inviter.commission_rate ?? S.config.invite.invite_commission)) / 100) : 0,
    actual_commission_balance: null,
    paid_at: null,
    created_at: NOW,
    updated_at: NOW,
  }
  S.orders.push(order)
  return { data: order.trade_no }
})

/* ------------------------------ user ------------------------------ */

route('/user/fetch', (input) => {
  const sortKey = input.sort || 'created_at'
  const sortType = ['ASC', 'DESC'].includes(input.sort_type) ? input.sort_type : 'DESC'
  const rows = filterUsers(input).map(userListRow)
  const page = paginate(sortBy(rows, sortKey, sortType), input)
  return { data: page.data, total: page.total }
})
route('/user/getUserInfoById', (input) => {
  if (!input.id) abort(500, '参数错误')
  const user = S.users.find((u) => u.id === int(input.id))
  if (!user) abort(500, 'Attempt to read property "invite_user_id" on null')
  const data = { ...user }
  if (user.invite_user_id) {
    const inviter = S.users.find((u) => u.id === user.invite_user_id)
    data.invite_user = inviter ? { ...inviter } : null
  }
  return { data }
})
const USER_UPDATE_FIELDS = {
  email: 'str', transfer_enable: 'int', device_limit: 'intn', expired_at: 'intn', banned: 'int', plan_id: 'intn',
  commission_rate: 'intn', discount: 'intn', is_admin: 'int', is_staff: 'int', u: 'int', d: 'int', balance: 'int',
  commission_type: 'int', commission_balance: 'int', remarks: 'strn', speed_limit: 'intn',
}
route('/user/update', (input) => {
  if (!input.email) validation('email', '邮箱不能为空')
  const user = S.users.find((u) => u.id === int(input.id))
  if (!user) abort(500, '用户不存在')
  if (S.users.some((u) => u.email === input.email && u.id !== user.id)) abort(500, '邮箱已被使用')
  // 与 UserController::update 一致：plan_id 非空 → 查套餐取 group_id；否则 group_id 置 null
  let groupId = null
  if (input.plan_id !== undefined && input.plan_id !== null && input.plan_id !== '') {
    const plan = S.plans.find((p) => p.id === int(input.plan_id))
    if (!plan) abort(500, '订阅计划不存在')
    groupId = plan.group_id
  }
  for (const [k, kind] of Object.entries(USER_UPDATE_FIELDS)) {
    if (!has(input, k)) continue
    const v = input[k]
    user[k] = kind === 'int' ? int(v, 0) : kind === 'intn' ? int(v) : kind === 'strn' ? (v === '' || v == null ? null : String(v)) : String(v)
  }
  user.group_id = groupId
  // invite_user_email：填了且查得到 → 改；填了查不到 → 不动；没填 → 置 null
  if (input.invite_user_email) {
    const inviter = S.users.find((u) => u.email === input.invite_user_email)
    if (inviter) user.invite_user_id = inviter.id
  } else {
    user.invite_user_id = null
  }
  user.updated_at = NOW
  return OK
})
function createUser(email, plan, expiredAt) {
  const user = {
    id: nextId(S.users),
    invite_user_id: null,
    telegram_id: null,
    email,
    balance: 0,
    discount: null,
    commission_type: 0,
    commission_rate: null,
    commission_balance: 0,
    t: 0,
    u: 0,
    d: 0,
    transfer_enable: plan ? plan.transfer_enable * GiB : 0,
    device_limit: plan ? plan.device_limit : null,
    banned: 0,
    is_admin: 0,
    is_staff: 0,
    last_login_at: null,
    last_login_ip: null,
    uuid: guid(true),
    group_id: plan ? plan.group_id : null,
    plan_id: plan ? plan.id : null,
    speed_limit: null,
    auto_renewal: 0,
    remind_expire: 1,
    remind_traffic: 1,
    token: guid(),
    expired_at: expiredAt,
    remarks: null,
    created_at: NOW,
    updated_at: NOW,
  }
  S.users.push(user)
  return user
}
route('/user/generate', (input) => {
  if (!input.email_suffix) validation('email_suffix', '邮箱后缀不能为空')
  let plan = null
  if (input.plan_id) {
    plan = S.plans.find((p) => p.id === int(input.plan_id))
    if (!plan) abort(500, '订阅计划不存在')
  }
  const expiredAt = input.expired_at === undefined || input.expired_at === '' ? null : int(input.expired_at)
  if (input.email_prefix) {
    const email = `${input.email_prefix}@${input.email_suffix}`
    if (S.users.some((u) => u.email === email)) abort(500, '邮箱已存在于系统中')
    createUser(email, plan, expiredAt)
    return OK
  }
  const count = Math.min(500, Math.max(0, int(input.generate_count, 0)))
  if (!count) return new Raw('')
  let data = '账号,密码,过期时间,UUID,创建时间,订阅地址\r\n'
  for (let i = 0; i < count; i++) {
    const email = `${randomChar(6)}@${input.email_suffix}`
    const user = createUser(email, plan, expiredAt)
    const expire = user.expired_at === null ? '长期有效' : phpDate(user.expired_at)
    data += `${email},${input.password ?? email},${expire},${user.uuid},${phpDate(user.created_at)},${subscribeUrl(user.token)}\r\n`
  }
  return new Raw(data)
})
route('/user/dumpCSV', (input) => new Raw(usersCsv(sortBy(filterUsers(input), 'id', 'ASC'))))
route('/user/sendMail', (input) => {
  if (!input.subject) validation('subject', '主题不能为空')
  if (!input.content) validation('content', '发送内容不能为空')
  return OK
})
route('/user/ban', (input) => {
  for (const u of filterUsers(input)) {
    u.banned = 1
    u.updated_at = NOW
  }
  return OK
})
route('/user/resetSecret', (input) => {
  const user = S.users.find((u) => u.id === int(input.id))
  if (!user) abort(500, '用户不存在')
  user.token = guid()
  user.uuid = guid(true)
  user.updated_at = NOW
  return OK
})
function deleteUsers(ids) {
  const set = new Set(ids)
  S.users = S.users.filter((u) => !set.has(u.id))
  S.orders = S.orders.filter((o) => !set.has(o.user_id))
  const ticketIds = new Set(S.tickets.filter((t) => set.has(t.user_id)).map((t) => t.id))
  S.tickets = S.tickets.filter((t) => !ticketIds.has(t.id))
  S.messages = S.messages.filter((m) => !ticketIds.has(m.ticket_id))
  for (const u of S.users) if (set.has(u.invite_user_id)) u.invite_user_id = null
}
route('/user/delUser', (input) => {
  const user = S.users.find((u) => u.id === int(input.id))
  if (!user) abort(500, '用户不存在')
  deleteUsers([user.id])
  return OK
})
route('/user/allDel', (input) => {
  deleteUsers(filterUsers(input).map((u) => u.id))
  return OK
})
route('/user/setInviteUser', deadRoute('UserController', 'setInviteUser'))

/* ------------------------------ stat ------------------------------ */

const seriesIn = (from, to) => S.series.filter((d) => d.record_at >= from && d.record_at < to)
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0)
function todayPartial() {
  const frac = Math.max(0.06, (NOW - TODAY) / DAY)
  const last = S.series[S.series.length - 1]
  return {
    paid_total: Math.round(last.paid_total * 1.03 * frac),
    commission_total: Math.round(last.commission_total * frac),
  }
}
route('/stat/getOverride', () => {
  const today = todayPartial()
  const thisMonth = seriesIn(MONTH_START, TODAY)
  const lastMonth = seriesIn(LAST_MONTH_START, MONTH_START)
  const dayRegister = S.users.filter((u) => u.created_at >= TODAY && u.created_at < NOW).length
  const onlineNodes = allNodes().filter((n) => n.parent_id == null && n.online)
  return {
    data: {
      online_user: Math.round(sum(onlineNodes, 'online') * 0.86),
      month_income: sum(thisMonth, 'paid_total') + today.paid_total,
      month_register_total: sum(thisMonth, 'register_count') + dayRegister,
      day_register_total: dayRegister,
      ticket_pending_total: S.tickets.filter((t) => t.status === 0 && t.reply_status === 0).length,
      commission_pending_total: S.orders.filter((o) => o.commission_status === 0 && o.invite_user_id != null && ![0, 2].includes(o.status) && o.commission_balance > 0).length,
      day_income: today.paid_total,
      last_month_income: sum(lastMonth, 'paid_total'),
      commission_month_payout: sum(thisMonth, 'commission_total') + today.commission_total,
      commission_last_month_payout: sum(lastMonth, 'commission_total'),
    },
  }
})
route('/stat/getOrder', () => {
  // 与后端一致：按 record_at DESC 取 31 条、每天 5 个指标，最后整体 array_reverse
  const days = S.series.slice(-31).reverse()
  const result = []
  for (const s of days) {
    const p = cst(s.record_at)
    const date = `${pad(p.m)}-${pad(p.d)}`
    result.push({ type: '注册人数', date, value: s.register_count })
    result.push({ type: '收款金额', date, value: s.paid_total / 100 })
    result.push({ type: '收款笔数', date, value: s.paid_count })
    result.push({ type: '佣金金额(已发放)', date, value: s.commission_total / 100 })
    result.push({ type: '佣金笔数(已发放)', date, value: s.commission_count })
  }
  return { data: result.reverse() }
})
function serverRank(isToday) {
  const r = mulberry32(isToday ? 101 : 202)
  const frac = isToday ? Math.max(0.08, (NOW - TODAY) / DAY) : 1
  const rows = allNodes()
    .filter((n) => n.parent_id == null && n.available_status !== 0)
    .map((n) => {
      const rt = S.runtime[`${n.type}:${n.id}`]
      const bytes = Math.round((rt?.weight ?? 10) * (0.75 + r() * 0.5) * frac * GiB)
      const u = Math.round(bytes * (0.04 + r() * 0.05))
      const d = bytes - u
      return { server_id: n.id, server_type: n.type, u, d, total: (u + d) / GiB, server_name: n.name }
    })
  return sortBy(rows, 'total', 'DESC').slice(0, 15)
}
function userRank(isToday) {
  const r = mulberry32(isToday ? 303 : 404)
  const frac = isToday ? Math.max(0.08, (NOW - TODAY) / DAY) : 1
  const candidates = S.users.filter((u) => u.plan_id && !u.banned && (u.expired_at === null || u.expired_at > NOW))
  const chosen = []
  const pool = [...candidates]
  while (chosen.length < 14 && pool.length) chosen.push(pool.splice(Math.floor(r() * pool.length), 1)[0])
  const rows = chosen.map((u, i) => {
    const gb = (46 * Math.pow(0.82, i) + r() * 3) * frac
    const rate = [1, 1, 1.5, 2][Math.floor(r() * 4)]
    const bytes = Math.round((gb / rate) * GiB)
    const up = Math.round(bytes * (0.05 + r() * 0.06))
    return { user_id: u.id, u: up, d: bytes - up, total: ((bytes * rate) / GiB), email: u.email }
  })
  // 一个已被删除的用户：后端返回字符串 "null"
  const ghostBytes = Math.round(9.6 * frac * GiB)
  rows.push({ user_id: 61, u: Math.round(ghostBytes * 0.07), d: ghostBytes - Math.round(ghostBytes * 0.07), total: ghostBytes / GiB, email: 'null' })
  return sortBy(rows, 'total', 'DESC').slice(0, 15)
}
route('/stat/getServerTodayRank', () => ({ data: serverRank(true) }))
route('/stat/getServerLastRank', () => ({ data: serverRank(false) }))
route('/stat/getUserTodayRank', () => ({ data: userRank(true) }))
route('/stat/getUserLastRank', () => ({ data: userRank(false) }))
route('/stat/getStatUser', (input) => {
  const userId = int(input.user_id)
  if (userId === null) validation('user_id', 'The user id field is required.')
  const r = mulberry32(1000 + userId)
  const records = []
  for (let k = 0; k < 30; k++) {
    const at = TODAY - k * DAY
    const rates = r() < 0.35 ? ['1.00', '1.50'] : ['1.00']
    for (const rate of rates) {
      const bytes = Math.round((0.3 + r() * 6) * GiB)
      const up = Math.round(bytes * (0.05 + r() * 0.06))
      records.push({
        id: userId * 1000 + records.length + 1,
        user_id: userId,
        server_rate: rate,
        u: up,
        d: bytes - up,
        record_type: 'd',
        record_at: at,
        created_at: at + 300,
        updated_at: k === 0 ? NOW - 60 : at + DAY - 60,
      })
    }
  }
  return paginate(records, input)
})
route('/stat/getStat', deadRoute('StatController', 'getStat'))
route('/stat/getRanking', deadRoute('StatController', 'getRanking'))
route('/stat/getStatRecord', deadRoute('StatController', 'getStatRecord'))

/* ------------------------------ notice ------------------------------ */

route('/notice/fetch', () => ({ data: sortBy(S.notices, 'id', 'DESC').map((n) => ({ ...n })) }))
route('/notice/save', (input) => {
  if (!input.title) validation('title', '标题不能为空')
  if (!input.content) validation('content', '内容不能为空')
  if (input.img_url !== undefined && input.img_url !== null && !/^https?:\/\//.test(String(input.img_url))) validation('img_url', '图片URL格式不正确')
  const fields = {
    title: String(input.title),
    content: String(input.content),
    img_url: input.img_url || null,
    tags: asList(input.tags).length ? asList(input.tags).map(String) : null,
  }
  if (input.id) {
    const n = S.notices.find((x) => x.id === int(input.id))
    if (!n) abort(500, '公告不存在')
    Object.assign(n, fields, { updated_at: NOW })
  } else {
    S.notices.push({ id: nextId(S.notices), ...fields, show: 0, created_at: NOW, updated_at: NOW })
  }
  return OK
})
route('/notice/show', (input) => {
  const n = S.notices.find((x) => x.id === int(input.id))
  if (!n) abort(500, '公告不存在')
  n.show = n.show ? 0 : 1
  n.updated_at = NOW
  return OK
})
route('/notice/drop', (input) => {
  const idx = S.notices.findIndex((x) => x.id === int(input.id))
  if (idx < 0) abort(500, '公告不存在')
  S.notices.splice(idx, 1)
  return OK
})
route('/notice/update', deadRoute('NoticeController', 'update'))

/* ------------------------------ ticket ------------------------------ */

route('/ticket/fetch', (input) => {
  if (input.id) {
    const ticket = S.tickets.find((t) => t.id === int(input.id))
    if (!ticket) abort(500, '工单不存在')
    const message = S.messages
      .filter((m) => m.ticket_id === ticket.id)
      .map((m) => ({ ...m, is_me: m.user_id !== ticket.user_id }))
    return { data: { ...ticket, message } }
  }
  let rows = S.tickets
  if (input.status !== undefined && input.status !== null && input.status !== '') rows = rows.filter((t) => t.status === int(input.status))
  if (input.reply_status !== undefined && input.reply_status !== null) {
    const set = asList(input.reply_status).map((x) => int(x))
    rows = rows.filter((t) => set.includes(t.reply_status))
  }
  if (input.email) {
    const user = S.users.find((u) => u.email === input.email)
    if (user) rows = rows.filter((t) => t.user_id === user.id)
  }
  return paginate(sortBy(rows, 'updated_at', 'DESC').map((t) => ({ ...t })), input)
})
route('/ticket/reply', (input) => {
  if (!input.id) abort(500, '参数错误')
  if (!input.message) abort(500, '消息不能为空')
  const ticket = S.tickets.find((t) => t.id === int(input.id))
  if (!ticket) abort(500, '工单不存在')
  if (ticket.status === 1) abort(500, '工单已关闭，无法回复')
  S.messages.push({ id: nextId(S.messages), user_id: 1, ticket_id: ticket.id, message: String(input.message), created_at: NOW, updated_at: NOW })
  ticket.reply_status = 1
  ticket.updated_at = NOW
  return OK
})
route('/ticket/close', (input) => {
  if (!input.id) abort(500, '参数错误')
  const ticket = S.tickets.find((t) => t.id === int(input.id))
  if (!ticket) abort(500, '工单不存在')
  ticket.status = 1
  ticket.updated_at = NOW
  return OK
})

/* ------------------------------ coupon ------------------------------ */

route('/coupon/fetch', (input) => {
  const sortKey = input.sort || 'id'
  const sortType = ['ASC', 'DESC'].includes(input.sort_type) ? input.sort_type : 'DESC'
  return paginate(sortBy(S.coupons, sortKey, sortType).map((c) => ({ ...c })), input)
})
function couponFields(input) {
  return {
    name: String(input.name),
    type: int(input.type, 1),
    value: int(input.value, 0),
    started_at: int(input.started_at, NOW),
    ended_at: int(input.ended_at, NOW + 30 * DAY),
    limit_use: int(input.limit_use),
    limit_use_with_user: int(input.limit_use_with_user),
    limit_plan_ids: asList(input.limit_plan_ids).length ? asList(input.limit_plan_ids).map(Number) : null,
    limit_period: asList(input.limit_period).length ? asList(input.limit_period).map(String) : null,
  }
}
route('/coupon/generate', (input) => {
  if (!input.name) validation('name', '名称不能为空')
  if (![1, 2].includes(int(input.type))) validation('type', '优惠券类型格式有误')
  if (input.value === undefined || input.value === '') validation('value', '金额或比例不能为空')
  const fields = couponFields(input)
  if (int(input.generate_count)) {
    const count = Math.min(500, int(input.generate_count))
    let data = '名称,类型,金额或比例,开始时间,结束时间,可用次数,可用于订阅,券码,生成时间\r\n'
    for (let i = 0; i < count; i++) {
      const c = { id: nextId(S.coupons), code: randomChar(8), ...fields, show: 1, created_at: NOW, updated_at: NOW }
      S.coupons.push(c)
      const type = ['', '金额', '比例'][c.type]
      const value = ['', c.value / 100, c.value][c.type]
      const plans = c.limit_plan_ids ? c.limit_plan_ids.join('/') : '不限制'
      data += `${c.name},${type},${value},${phpDate(c.started_at)},${phpDate(c.ended_at)},${c.limit_use ?? '不限制'},${plans},${c.code},${phpDate(c.created_at)}\r\n`
    }
    return new Raw(data)
  }
  if (input.id) {
    const c = S.coupons.find((x) => x.id === int(input.id))
    if (!c) abort(500, '保存失败')
    Object.assign(c, fields, input.code ? { code: String(input.code) } : {}, { updated_at: NOW })
  } else {
    S.coupons.push({ id: nextId(S.coupons), code: input.code ? String(input.code) : randomChar(8), ...fields, show: 0, created_at: NOW, updated_at: NOW })
  }
  return OK
})
route('/coupon/show', (input) => {
  if (!input.id) abort(500, '参数有误')
  const c = S.coupons.find((x) => x.id === int(input.id))
  if (!c) abort(500, '优惠券不存在')
  c.show = c.show ? 0 : 1
  c.updated_at = NOW
  return OK
})
route('/coupon/drop', (input) => {
  if (!input.id) abort(500, '参数有误')
  const idx = S.coupons.findIndex((x) => x.id === int(input.id))
  if (idx < 0) abort(500, '优惠券不存在')
  S.coupons.splice(idx, 1)
  return OK
})

/* ------------------------------ giftcard ------------------------------ */

route('/giftcard/fetch', (input) => {
  const sortKey = input.sort || 'id'
  const sortType = ['ASC', 'DESC'].includes(input.sort_type) ? input.sort_type : 'DESC'
  return paginate(sortBy(S.giftcards, sortKey, sortType).map(giftcardRow), input)
})
route('/giftcard/generate', (input) => {
  if (!input.name) validation('name', '名称不能为空')
  const type = int(input.type)
  if (![1, 2, 3, 4, 5].includes(type)) validation('type', '礼品卡类型格式有误')
  if ([1, 2, 3, 5].includes(type) && (input.value === undefined || input.value === '')) validation('value', '数值不能为空')
  if (type === 5 && !input.plan_id) validation('plan_id', '套餐不能为空')
  const fields = {
    name: String(input.name),
    type,
    value: type === 4 ? null : int(input.value),
    plan_id: type === 5 ? int(input.plan_id) : null,
    limit_use: int(input.limit_use),
    started_at: int(input.started_at, NOW),
    ended_at: int(input.ended_at, NOW + 30 * DAY),
  }
  if (int(input.generate_count)) {
    const count = Math.min(500, int(input.generate_count))
    let data = '名称,类型,数值,开始时间,结束时间,可用次数,礼品卡卡密,生成时间\r\n'
    const v = fields.value ?? 0
    for (let i = 0; i < count; i++) {
      const g = { id: nextId(S.giftcards), code: randomChar(16), ...fields, used_user_ids: null, created_at: NOW, updated_at: NOW }
      S.giftcards.push(g)
      const typeLabel = ['', '金额', '时长', '流量', '重置', '套餐'][type]
      const valueLabel = ['', Math.round(v) / 100, `${v}天`, `${v}GB`, '-', `${v}天`][type]
      data += `${g.name},${typeLabel},${valueLabel},${phpDate(g.started_at)},${phpDate(g.ended_at)},${g.limit_use ?? '不限制'},${g.code},${phpDate(g.created_at)}\r\n`
    }
    return new Raw(data)
  }
  if (input.id) {
    const g = S.giftcards.find((x) => x.id === int(input.id))
    if (!g) abort(500, '礼品卡不存在')
    Object.assign(g, fields, input.code ? { code: String(input.code) } : {}, { updated_at: NOW })
  } else {
    S.giftcards.push({ id: nextId(S.giftcards), code: input.code ? String(input.code) : randomChar(16), ...fields, used_user_ids: null, created_at: NOW, updated_at: NOW })
  }
  return OK
})
route('/giftcard/drop', (input) => {
  const idx = S.giftcards.findIndex((x) => x.id === int(input.id))
  if (idx < 0) abort(500, '礼品卡不存在')
  S.giftcards.splice(idx, 1)
  return OK
})

/* ------------------------------ knowledge ------------------------------ */

route('/knowledge/fetch', (input) => {
  if (input.id) {
    const k = S.knowledge.find((x) => x.id === int(input.id))
    if (!k) abort(500, '知识不存在')
    return { data: { ...k } }
  }
  return {
    data: sortBy(S.knowledge, 'sort').map(({ title, id, updated_at, category, show }) => ({ title, id, updated_at, category, show })),
  }
})
route('/knowledge/getCategory', () => ({ data: [...new Set(S.knowledge.map((k) => k.category))] }))
route('/knowledge/save', (input) => {
  for (const f of ['category', 'language', 'title', 'body']) if (!input[f]) validation(f, `${f} 不能为空`)
  const fields = { category: String(input.category), language: String(input.language), title: String(input.title), body: String(input.body) }
  if (input.id) {
    const k = S.knowledge.find((x) => x.id === int(input.id))
    if (!k) abort(500, '知识不存在')
    Object.assign(k, fields, { updated_at: NOW })
  } else {
    S.knowledge.push({ id: nextId(S.knowledge), ...fields, sort: null, show: 0, created_at: NOW, updated_at: NOW })
  }
  return OK
})
route('/knowledge/show', (input) => {
  const k = S.knowledge.find((x) => x.id === int(input.id))
  if (!k) abort(500, '知识不存在')
  k.show = k.show ? 0 : 1
  k.updated_at = NOW
  return OK
})
route('/knowledge/drop', (input) => {
  const idx = S.knowledge.findIndex((x) => x.id === int(input.id))
  if (idx < 0) abort(500, '知识不存在')
  S.knowledge.splice(idx, 1)
  return OK
})
route('/knowledge/sort', (input) => {
  asList(input.knowledge_ids).forEach((id, i) => {
    const k = S.knowledge.find((x) => x.id === int(id))
    if (k) k.sort = i + 1
  })
  return OK
})

/* ------------------------------ payment ------------------------------ */

route('/payment/fetch', () => ({ data: sortBy(S.payments, 'sort').map(paymentRow) }))
route('/payment/getPaymentMethods', () => ({ data: PAYMENT_METHODS }))
route('/payment/getPaymentForm', (input) => {
  const method = String(input.payment || '')
  if (!PAYMENT_METHODS.includes(method)) abort(500, '网关不存在')
  const form = structuredClone(PAYMENT_FORMS[method] || GENERIC_PAYMENT_FORM)
  if (input.id) {
    const p = S.payments.find((x) => x.id === int(input.id))
    const config = p && p.payment === method ? p.config || {} : {}
    for (const key of Object.keys(form)) if (has(config, key)) form[key].value = config[key]
  }
  return { data: form }
})
route('/payment/save', (input) => {
  if (!S.config.site.app_url) abort(500, '请在站点配置中配置站点地址')
  if (!input.name) validation('name', '显示名称不能为空')
  if (!input.payment) validation('payment', '网关参数不能为空')
  if (!input.config || typeof input.config !== 'object') validation('config', '配置参数不能为空')
  // 真实后端 notify_domain 是 required|url（前端当作可选，留空会 422）
  if (!input.notify_domain) validation('notify_domain', '请填写支付回调域名，不能使用后端地址')
  if (!/^https?:\/\//.test(String(input.notify_domain))) validation('notify_domain', '支付回调域名格式有误')
  const pct = numOrNull(input.handling_fee_percent)
  if (pct !== null && (pct < 0.1 || pct > 100)) validation('handling_fee_percent', '百分比手续费范围须在0.1-100之间')
  const fields = {
    name: String(input.name),
    icon: input.icon || null,
    payment: String(input.payment),
    config: input.config,
    notify_domain: String(input.notify_domain),
    handling_fee_fixed: int(input.handling_fee_fixed),
    handling_fee_percent: pct === null ? null : pct.toFixed(2),
  }
  if (input.id) {
    const p = S.payments.find((x) => x.id === int(input.id))
    if (!p) abort(500, '支付方式不存在')
    Object.assign(p, fields, { updated_at: NOW })
  } else {
    S.payments.push({ id: nextId(S.payments), uuid: randomChar(8), ...fields, enable: 0, sort: null, created_at: NOW, updated_at: NOW })
  }
  return OK
})
route('/payment/show', (input) => {
  const p = S.payments.find((x) => x.id === int(input.id))
  if (!p) abort(500, '支付方式不存在')
  p.enable = p.enable ? 0 : 1
  p.updated_at = NOW
  return OK
})
route('/payment/drop', (input) => {
  const idx = S.payments.findIndex((x) => x.id === int(input.id))
  if (idx < 0) abort(500, '支付方式不存在')
  S.payments.splice(idx, 1)
  return OK
})
route('/payment/sort', (input) => {
  const ids = asList(input.ids)
  if (!ids.length) validation('ids', '参数有误')
  ids.forEach((id, i) => {
    const p = S.payments.find((x) => x.id === int(id))
    if (!p) abort(500, 'Call to a member function update() on null')
    p.sort = i + 1
  })
  return OK
})

/* ------------------------------ system ------------------------------ */

const QUEUES = [
  { name: 'order_handle', length: 0, wait: 0, processes: 2, split_queues: null },
  { name: 'send_email', length: 3, wait: 1, processes: 1, split_queues: null },
  { name: 'send_email_mass', length: 128, wait: 42, processes: 2, split_queues: null },
  { name: 'send_telegram', length: 0, wait: 0, processes: 1, split_queues: null },
  { name: 'stat', length: 0, wait: 0, processes: 1, split_queues: null },
  { name: 'traffic_fetch', length: 17, wait: 2, processes: 5, split_queues: null },
]
route('/system/getSystemStatus', () => ({
  data: { schedule: true, horizon: true, schedule_last_runtime: Math.floor(Date.now() / 1000) - 23 },
}))
route('/system/getQueueStats', () => ({
  data: {
    failedJobs: 3,
    jobsPerMinute: 46,
    pausedMasters: 0,
    periods: { failedJobs: 10080, recentJobs: 60 },
    processes: QUEUES.reduce((s, q) => s + q.processes, 0),
    queueWithMaxRuntime: 'send_email_mass',
    queueWithMaxThroughput: 'traffic_fetch',
    recentJobs: 2764,
    status: true,
    wait: { 'redis:send_email_mass': 42 },
  },
}))
route('/system/getQueueWorkload', () => ({ data: QUEUES.map((q) => ({ ...q })) }))
/** Horizon MasterSupervisorController@index 的原生响应：以 master 名为键的对象，不包 {data} */
route('/system/getQueueMasters', () => {
  const master = 'xingyun-prod-01-Xk3p'
  return {
    [master]: {
      name: master,
      environment: 'production',
      pid: '1843',
      status: 'running',
      supervisors: [
        {
          name: `${master}:V2board`,
          master,
          pid: '1851',
          status: 'running',
          processes: Object.fromEntries(QUEUES.map((q) => [`redis:${q.name}`, q.processes])),
          options: {
            connection: 'redis',
            queue: QUEUES.map((q) => q.name).join(','),
            balance: 'auto',
            minProcesses: 1,
            maxProcesses: 24,
            tries: 1,
            timeout: 60,
            memory: 128,
            sleep: 3,
            balanceCooldown: 3,
            balanceMaxShift: 1,
            parentId: 1843,
            nice: 0,
          },
        },
      ],
    },
  }
})
route('/system/getSystemLog', (input) => {
  let rows = sortBy(S.logs, 'created_at', 'DESC')
  if (input.level) rows = rows.filter((l) => l.level === input.level)
  return paginate(rows.map((l) => ({ ...l })), input, 'page_size')
})

/* ------------------------------ theme ------------------------------ */

route('/theme/getThemes', () => ({ data: { themes: THEMES, active: S.config.frontend.frontend_theme } }))
route('/theme/getThemeConfig', (input) => {
  if (!THEMES[input.name]) validation('name', 'The selected name is invalid.')
  return { data: S.themeConfigs[input.name] ?? null }
})
route('/theme/saveThemeConfig', (input) => {
  if (!THEMES[input.name]) validation('name', 'The selected name is invalid.')
  if (!input.config) validation('config', 'The config field is required.')
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(String(input.config), 'base64').toString('utf8'))
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed !== 'object') abort(500, '参数有误')
  const config = {}
  for (const item of THEMES[input.name].configs) config[item.field_name] = has(parsed, item.field_name) ? parsed[item.field_name] : ''
  S.themeConfigs[input.name] = config
  return { data: config }
})

/* ================================================================== *
 * 免鉴权接口
 * ================================================================== */

function login() {
  return { data: { token: hex(32), is_admin: 1, auth_data: 'mock-jwt' } }
}

/* ================================================================== *
 * HTTP
 * ================================================================== */

function unknownRoute(method, path) {
  console.warn(`[mock] 未实现的接口: ${method} ${path}`)
  return path.endsWith('/fetch') ? { data: [], total: 0 } : { data: true }
}

async function dispatch(req, path, input) {
  if (path === '/__mock/reset') {
    S = buildState()
    return { data: true }
  }
  if (path === '/api/v1/passport/auth/login') return login(input)
  if (path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`)) {
    const auth = req.headers.authorization || input.auth_data
    if (!auth) abort(403, '未登录或登陆已过期')
    const sub = path.slice(ADMIN_PREFIX.length)
    const handler = R.get(sub)
    if (handler) return handler(input, req)
    return unknownRoute(req.method, path)
  }
  if (path.startsWith('/api/')) return unknownRoute(req.method, path)
  return new Raw(
    `V2Board admin mock backend\nadmin prefix: ${ADMIN_PREFIX}\nroutes: ${R.size}\n`,
    'text/plain; charset=UTF-8',
  )
}

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept,X-Requested-With')
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = http.createServer(async (req, res) => {
  const started = Date.now()
  let status = 200
  let path = req.url
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`)
    path = url.pathname.replace(/\/+$/, '') || '/'
    setCors(req, res)
    if (req.method === 'OPTIONS') {
      status = 204
      res.writeHead(204)
      res.end()
      return
    }
    const query = parsePhpParams(url.searchParams)
    const body = await readBody(req)
    // Laravel 的 $request->input() 同时读 query 与 body
    const input = { ...query, ...body }
    if (DELAY) await sleep(DELAY)
    const result = await dispatch(req, path, input)
    if (result instanceof Raw) {
      status = result.status
      res.writeHead(result.status, { 'Content-Type': result.type, 'Content-Length': Buffer.byteLength(result.body) })
      res.end(result.body)
    } else {
      sendJson(res, 200, result)
    }
  } catch (err) {
    if (err instanceof HttpError) {
      status = err.status
      sendJson(res, err.status, { message: err.message, ...err.extra })
    } else {
      status = 500
      console.error(err)
      sendJson(res, 500, { message: String(err && err.message ? err.message : err) })
    }
  } finally {
    const flag = status >= 500 ? ' !!' : status >= 400 ? ' !' : ''
    console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${path} -> ${status} ${Date.now() - started}ms${flag}`)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[mock] V2Board admin mock backend: http://${HOST}:${PORT}`)
  console.log(`[mock] admin prefix ${ADMIN_PREFIX} · ${R.size} routes · strict=${STRICT ? 'on' : 'off'}`)
  console.log(`[mock] SPA: VITE_API_TARGET=http://${HOST}:${PORT} npx vite  →  http://localhost:5173/${SECURE_PATH}/v2/login`)
})
