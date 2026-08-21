/**
 * Laravel / PHP 风格的 query string 序列化。
 *
 * 为什么需要：后端的列表过滤参数是嵌套结构
 *     filter[0][key]=email&filter[0][condition]=模糊&filter[0][value]=abc
 * （见 UserController::filter()）。axios 默认序列化器遇到数组里的对象会
 * 整个 JSON.stringify 成 `filter[]={"key":...}`，PHP 那边收到的是字符串而不是数组，
 * 过滤会静默失效 —— 不报错，只是筛选没生效，很难排查。
 *
 * 只影响 GET 的 query string。POST 走 JSON body，Laravel 能原生解析嵌套数组
 * （已在测试机用 payment/getPaymentForm 验证）。
 */

function flatten(
  key: string,
  value: unknown,
  out: [string, string][],
): void {
  // null / undefined 一律不发：后端的 filter.*.value 是 required，
  // 发空值会变成 422，不如不发这一项
  if (value === null || value === undefined) return

  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(`${key}[${index}]`, item, out))
    return
  }

  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
      flatten(`${key}[${k}]`, v, out),
    )
    return
  }

  if (typeof value === 'boolean') {
    // PHP 侧的 in:0,1 校验只认 0/1，不认 true/false
    out.push([key, value ? '1' : '0'])
    return
  }

  out.push([key, String(value)])
}

export function serializeParams(params: Record<string, unknown>): string {
  const pairs: [string, string][] = []
  Object.entries(params).forEach(([key, value]) => flatten(key, value, pairs))

  const search = new URLSearchParams()
  pairs.forEach(([k, v]) => search.append(k, v))
  return search.toString()
}
