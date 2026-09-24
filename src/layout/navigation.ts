/**
 * 侧边栏导航结构。
 *
 * 与计划的分阶段推进对应：`phase` 标记该页面属于哪一阶段，
 * `done: false` 的项在界面上会显示成「待实现」占位页，
 * 这样 Phase 0 就能看到完整的信息架构，后续阶段只是把占位换成真页面。
 *
 * `group` 决定侧边栏里的分组标题，顺序按 NAV_GROUPS。
 */

export interface NavItem {
  /** 路由路径（相对 uiBasePath） */
  key: string
  label: string
  /** antd 图标名，在 AdminLayout 里映射成组件 */
  icon: string
  /** 所属分组，见 NAV_GROUPS */
  group: NavGroupKey
  /** 页面副标题，显示在顶栏标题下方 */
  description?: string
  /** 属于计划里的第几阶段 */
  phase: number
  /** 是否已实现 */
  done: boolean
}

export const NAV_GROUPS = [
  { key: 'overview', label: '概览' },
  { key: 'business', label: '用户与订单' },
  { key: 'commerce', label: '商品与营销' },
  { key: 'content', label: '内容' },
  { key: 'infra', label: '节点' },
  { key: 'system', label: '系统' },
] as const

export type NavGroupKey = (typeof NAV_GROUPS)[number]['key']

export const NAV_ITEMS: readonly NavItem[] = [
  { key: '/', label: '仪表盘', icon: 'dashboard', group: 'overview', description: '收入、用户与流量概况', phase: 5, done: true },
  { key: '/stat', label: '统计报表', icon: 'bar-chart', group: 'overview', description: '收入、用户与流量概况', phase: 5, done: true },
  { key: '/user', label: '用户管理', icon: 'team', group: 'business', description: '查询、编辑与批量管理用户', phase: 1, done: true },
  { key: '/order', label: '订单管理', icon: 'shopping', group: 'business', description: '订单查询、手动开通与佣金处理', phase: 2, done: true },
  { key: '/ticket', label: '工单管理', icon: 'message', group: 'business', description: '回复与关闭用户工单', phase: 7, done: true },
  { key: '/plan', label: '套餐管理', icon: 'appstore', group: 'commerce', description: '套餐价格、流量与售卖设置', phase: 3, done: true },
  { key: '/coupon', label: '优惠券', icon: 'tag', group: 'commerce', description: '生成与管理优惠码', phase: 3, done: true },
  { key: '/giftcard', label: '礼品卡', icon: 'gift', group: 'commerce', description: '生成与管理礼品卡', phase: 3, done: true },
  { key: '/notice', label: '公告管理', icon: 'notification', group: 'content', description: '发布面向用户的公告', phase: 3, done: true },
  { key: '/knowledge', label: '知识库', icon: 'book', group: 'content', description: '使用教程与帮助文档', phase: 3, done: true },
  { key: '/server', label: '节点管理', icon: 'cloud', group: 'infra', description: '节点、权限组与路由规则', phase: 4, done: true },
  { key: '/config', label: '系统配置', icon: 'setting', group: 'system', description: '站点、订阅、邮件与通知等全局设置', phase: 6, done: true },
  { key: '/payment', label: '支付配置', icon: 'credit-card', group: 'system', description: '支付网关与手续费', phase: 7, done: true },
  { key: '/theme', label: '主题配置', icon: 'skin', group: 'system', description: '用户前台主题', phase: 7, done: true },
  { key: '/system', label: '系统状态', icon: 'monitor', group: 'system', description: '队列、进程与系统日志', phase: 7, done: true },
]
