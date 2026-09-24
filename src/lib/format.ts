/**
 * 单位换算与展示格式化。
 *
 * 后端的单位约定（从源码逐个确认过，别凭直觉改）：
 *   - u / d / transfer_enable / total_used：**字节**
 *   - balance / commission_balance：**分**（int）
 *   - created_at / updated_at / expired_at / last_login_at：**unix 秒**
 *   - commission_rate / discount：百分比整数 0-100
 *
 * ⚠️ 有个不一致的地方：列表 filter 里 `transfer_enable` 和 `d` 的值是 **GB**
 * （UserController::filter() 会乘 1073741824），而 user/update 提交时是**字节**。
 * 换算函数分开命名就是为了不混用。
 */

const GIB = 1073741824

/** 字节 → GB 数值（保留 2 位，用于表单回填） */
export function bytesToGiB(bytes: number | null | undefined): number {
  if (!bytes) return 0
  return Math.round((bytes / GIB) * 100) / 100
}

/** GB → 字节（提交 user/update 时用） */
export function giBToBytes(gib: number | null | undefined): number {
  if (!gib) return 0
  return Math.round(gib * GIB)
}

/** 字节 → 人类可读（表格展示用） */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(2)} ${units[i]}`
}

/** 分 → 元（数值，用于表单回填） */
export function centsToYuan(cents: number | null | undefined): number {
  if (!cents) return 0
  return Math.round(cents) / 100
}

/** 元 → 分（提交时用；四舍五入到整分，避免浮点写进 int 列） */
export function yuanToCents(yuan: number | null | undefined): number {
  if (!yuan) return 0
  return Math.round(yuan * 100)
}

const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 分 → 「¥1,234.56」（只用于展示；表单回填用 centsToYuan） */
export function formatMoney(cents: number | null | undefined): string {
  const yuan = centsToYuan(cents)
  // 负数（退款、扣减）把符号放在 ¥ 前面：-¥12.00
  return `${yuan < 0 ? '-' : ''}¥${MONEY_FORMAT.format(Math.abs(yuan))}`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** unix 秒 → 'YYYY-MM-DD HH:mm'。null/0 返回 fallback */
export function formatTime(
  seconds: number | null | undefined,
  fallback = '-',
): string {
  if (!seconds) return fallback
  const d = new Date(seconds * 1000)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/**
 * 到期时间的展示。
 *
 * 后端语义有两种"无到期"：
 *   - null → dumpCSV 里当作「长期有效」（不过期）
 *   - 0    → 全新用户的默认值（本质是「未订阅」，因为 expired_at > time() 才算有效）
 * 两者不能混为一谈，所以分开显示。
 */
export function formatExpire(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '长期有效'
  if (seconds === 0) return '未订阅'
  return formatTime(seconds)
}

/** 到期时间是否已过 */
export function isExpired(seconds: number | null | undefined): boolean {
  if (seconds === null || seconds === undefined) return false
  return seconds * 1000 < Date.now()
}
