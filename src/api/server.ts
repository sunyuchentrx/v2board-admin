import { ADMIN_ENDPOINTS, serverProtocolEndpoint, type ServerProtocol } from './endpoints'
import { call } from './request'

export type { ServerProtocol }
export { SERVER_PROTOCOLS } from './endpoints'

/* ================================================================== *
 * 节点总览
 * ================================================================== */

/**
 * server/manage/getNodes 返回 ServerService::getAllServers() 的结果：
 * 8 种协议的节点合并成一个数组，按 sort 升序，每条带 type 标明协议。
 *
 * ⚠️ 后端会把 group_id / route_id / tags 这些 varchar 列解析成数组再返回
 * （ServerService 里 json_decode），所以读的时候是数组，写回去也要传数组。
 */
export interface ServerNode {
  id: number
  type: ServerProtocol
  name: string
  /** 已被后端解析成数组 */
  group_id: number[]
  route_id: number[] | null
  tags: string[] | null
  parent_id: number | null
  host: string
  /** 可能是单端口 "443" 也可能是端口段 "10000-20000"，所以是字符串 */
  port: string
  server_port: number
  /** 倍率，varchar 存的数字字符串 */
  rate: string
  show: number
  sort: number | null
  created_at: number
  updated_at: number
  /** 后端 mergeData 附加的运行时数据 */
  online?: number
  last_check_at?: number | null
  last_push_at?: number | null
  available_status?: number
  /** 协议特有字段，形状随 type 变 */
  [key: string]: unknown
}

export function fetchNodes() {
  return call<ServerNode[]>(ADMIN_ENDPOINTS.server.manageGetNodes)
}

/**
 * 批量重排。
 *
 * 载荷形状是按协议分组的 { 协议: { 节点id: sort值 } }，
 * 见 ManageController::sort() 的 $request->only(...) 与内层 foreach。
 */
export type NodeSortPayload = Partial<
  Record<ServerProtocol, Record<number, number>>
>

export function sortNodes(payload: NodeSortPayload) {
  return call<boolean>(ADMIN_ENDPOINTS.server.manageSort, payload as Record<string, unknown>)
}

/* ================================================================== *
 * 协议节点的增删改
 * ================================================================== */

/** 8 种协议共有的字段 */
export interface ServerCommonFields {
  id?: number
  name: string
  /** 必填且必须是数组（各 Save 的 required|array） */
  group_id: number[]
  route_id?: number[] | null
  parent_id?: number | null
  tags?: string[] | null
  host: string
  port: string
  server_port: number
  /** 必填且 numeric */
  rate: number | string
  show?: 0 | 1
  sort?: number | null
}

/** 新增/编辑节点。带 id 是编辑。 */
export function saveNode(
  protocol: ServerProtocol,
  payload: ServerCommonFields & Record<string, unknown>,
) {
  return call<boolean>(serverProtocolEndpoint(protocol, 'save'), payload)
}

export function dropNode(protocol: ServerProtocol, id: number) {
  return call<boolean>(serverProtocolEndpoint(protocol, 'drop'), { id })
}

/**
 * 切换显示状态。
 * ⚠️ 后端只取 show（各协议控制器的 $request->only(['show'])），
 * 其它字段传了不生效。而且是**设值**不是取反（和 coupon/notice 的 show 相反）。
 */
export function updateNodeShow(
  protocol: ServerProtocol,
  id: number,
  show: 0 | 1,
) {
  return call<boolean>(serverProtocolEndpoint(protocol, 'update'), { id, show })
}

/**
 * 复制节点。后端会把副本的 show 置 0（先隐藏），其余字段照抄。
 * ⚠️ 注意后端有个顺序问题：先 `$server->show = 0` 再判断 `if (!$server)`，
 * 所以传不存在的 id 会先触发 null 属性赋值错误 → 500，而不是「服务器不存在」。
 */
export function copyNode(protocol: ServerProtocol, id: number) {
  return call<boolean>(serverProtocolEndpoint(protocol, 'copy'), { id })
}

/* ================================================================== *
 * 权限组
 * ================================================================== */

export interface ServerGroup {
  id: number
  name: string
  created_at: number
  updated_at: number
  /** fetch 时后端附加 */
  user_count?: number
  server_count?: number
}

export function fetchServerGroups() {
  return call<ServerGroup[]>(ADMIN_ENDPOINTS.server.groupFetch)
}

/** 只能改名字（GroupController::save 只读 name） */
export function saveServerGroup(payload: { id?: number; name: string }) {
  return call<boolean>(ADMIN_ENDPOINTS.server.groupSave, payload)
}

/** 被任何节点引用的组不允许删除（后端逐协议检查 group_id 是否含该组） */
export function dropServerGroup(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.server.groupDrop, { id })
}

/* ================================================================== *
 * 路由规则
 * ================================================================== */

/** 动作白名单来自 RouteController::save 的 in:... */
export const ROUTE_ACTIONS = {
  block: '阻断',
  block_ip: '阻断 IP',
  block_port: '阻断端口',
  protocol: '协议',
  dns: 'DNS',
  route: '分流',
  route_ip: '分流 IP',
  default_out: '默认出口',
} as const

export type RouteAction = keyof typeof ROUTE_ACTIONS

export interface ServerRoute {
  id: number
  remarks: string
  /** 后端 fetch 时会 json_decode 成数组 */
  match: string[] | string
  action: string
  action_value: string | null
  created_at: number
  updated_at: number
}

export function fetchServerRoutes() {
  return call<ServerRoute[]>(ADMIN_ENDPOINTS.server.routeFetch)
}

export interface RouteSavePayload {
  id?: number
  remarks: string
  /** action 为 default_out 时可以为空（后端 required_unless），其余必填 */
  match?: string[]
  action: RouteAction
  action_value?: string | null
}

export function saveServerRoute(payload: RouteSavePayload) {
  return call<boolean>(ADMIN_ENDPOINTS.server.routeSave, {
    ...payload,
  } as unknown as Record<string, unknown>)
}

export function dropServerRoute(id: number) {
  return call<boolean>(ADMIN_ENDPOINTS.server.routeDrop, { id })
}
