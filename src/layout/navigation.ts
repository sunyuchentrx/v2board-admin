/**
 * 侧边栏导航结构。
 *
 * 与计划的分阶段推进对应：`phase` 标记该页面属于哪一阶段，
 * `done: false` 的项在界面上会显示成「待实现」占位页，
 * 这样 Phase 0 就能看到完整的信息架构，后续阶段只是把占位换成真页面。
 */

export interface NavItem {
  /** 路由路径（相对 uiBasePath） */
  key: string
  label: string
  /** antd 图标名，在 AdminLayout 里映射成组件 */
  icon: string
  /** 属于计划里的第几阶段 */
  phase: number
  /** 是否已实现 */
  done: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: '/', label: '仪表盘', icon: 'dashboard', phase: 5, done: true },
  { key: '/user', label: '用户管理', icon: 'team', phase: 1, done: true },
  { key: '/order', label: '订单管理', icon: 'shopping', phase: 2, done: true },
  { key: '/plan', label: '套餐管理', icon: 'appstore', phase: 3, done: true },
  { key: '/coupon', label: '优惠券', icon: 'tag', phase: 3, done: true },
  { key: '/giftcard', label: '礼品卡', icon: 'gift', phase: 3, done: true },
  { key: '/notice', label: '公告管理', icon: 'notification', phase: 3, done: true },
  { key: '/knowledge', label: '知识库', icon: 'book', phase: 3, done: true },
  { key: '/server', label: '节点管理', icon: 'cloud', phase: 4, done: true },
  { key: '/stat', label: '统计报表', icon: 'bar-chart', phase: 5, done: true },
  { key: '/config', label: '系统配置', icon: 'setting', phase: 6, done: true },
  { key: '/ticket', label: '工单管理', icon: 'message', phase: 7, done: true },
  { key: '/payment', label: '支付配置', icon: 'credit-card', phase: 7, done: true },
  { key: '/theme', label: '主题配置', icon: 'skin', phase: 7, done: true },
  { key: '/system', label: '系统状态', icon: 'dashboard', phase: 7, done: true },
]
