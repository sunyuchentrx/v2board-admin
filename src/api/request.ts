import { adminApiBase } from '@/settings'
import { http } from './client'
import type { Endpoint } from './endpoints'
import type { DataResponse, ListResponse, PageQuery } from './types'

/** 把 endpoints.ts 里的相对路径拼成完整的管理接口 URL */
export function adminUrl(endpoint: Endpoint): string {
  return `${adminApiBase}${endpoint.path}`
}

/**
 * 通用调用：GET 走 query string，POST 走请求体。
 * 后端所有接口都把有效载荷包在 {data: ...} 里，这里统一剥掉一层。
 */
export interface CallOptions {
  /** 调用方自己处理 422（逐字段落到表单），拦截器不弹全局提示 */
  handle422?: boolean
  /** 覆盖默认超时，长耗时接口用 LONG_TIMEOUT */
  timeout?: number
}

export async function call<T>(
  endpoint: Endpoint,
  payload?: Record<string, unknown>,
  options?: CallOptions,
): Promise<T> {
  const url = adminUrl(endpoint)
  const config = { handle422: options?.handle422, timeout: options?.timeout }
  const response =
    endpoint.method === 'GET'
      ? await http.get<DataResponse<T>>(url, { ...config, params: payload })
      : await http.post<DataResponse<T>>(url, payload, config)
  return response.data.data
}

/**
 * 列表调用：保留 total，因为分页要用。
 *
 * params 用 object 而不是 Record<string, unknown>：后者要求接口带索引签名，
 * 会让每个具名的查询类型（如 UserListQuery）都编译不过。
 */
export async function callList<T>(
  endpoint: Endpoint,
  params?: PageQuery & object,
): Promise<ListResponse<T>> {
  const response = await http.get<ListResponse<T>>(adminUrl(endpoint), {
    params,
  })
  return {
    data: response.data.data ?? [],
    total: response.data.total ?? 0,
  }
}

/**
 * antd ProTable 的 request 适配器。
 *
 * 能这么薄是因为后端本来就是照 antd Pro 的约定写的：分页参数就叫 current/pageSize，
 * 响应就是 {data,total}。唯一要补的是 ProTable 期望的 success 字段。
 */
export async function proTableRequest<T extends object>(
  endpoint: Endpoint,
  params: Record<string, unknown>,
  sort?: Record<string, 'ascend' | 'descend' | null>,
): Promise<{ data: T[]; total: number; success: boolean }> {
  const query: Record<string, unknown> = { ...params }

  // ProTable 的排序对象转成后端的 sort / sort_type
  if (sort) {
    const entries = Object.entries(sort).filter(([, order]) => order != null)
    const first = entries[0]
    if (first) {
      query.sort = first[0]
      query.sort_type = first[1] === 'ascend' ? 'ASC' : 'DESC'
    }
  }

  try {
    const result = await callList<T>(endpoint, query)
    return { data: result.data, total: result.total, success: true }
  } catch {
    // 错误提示已由 client.ts 的响应拦截器统一弹出（403 则跳登录），
    // 这里只负责让表格停止 loading、不要把异常抛进 ProTable 内部。
    return { data: [], total: 0, success: false }
  }
}
