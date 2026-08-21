import { Alert, Card, Descriptions, Typography } from 'antd'
import { ENDPOINT_COUNT } from '@/api/endpoints'
import { adminApiBase, securePath, uiBasePath } from '@/settings'
import type { NavItem } from '@/layout/navigation'

/**
 * 未实现页面的占位。Phase 0 用它把完整信息架构立起来，
 * 后续阶段逐个替换成真页面。
 *
 * 顺带把运行期契约信息显示出来 —— 部署后打开任意页面就能确认
 * secure_path 是否正确注入、API 基址是否拼对，不用翻控制台。
 */
export default function Placeholder({ item }: { item: NavItem }) {
  return (
    <Card>
      <Typography.Title level={4}>{item.label}</Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`本页计划在 Phase ${item.phase} 实现`}
        description="当前是新后台的骨架（Phase 0）。旧后台不受影响，可随时切回去使用。"
      />
      <Descriptions
        column={1}
        size="small"
        bordered
        items={[
          {
            key: 'securePath',
            label: 'secure_path',
            children: securePath ? (
              <Typography.Text code>{securePath}</Typography.Text>
            ) : (
              <Typography.Text type="danger">
                缺失 —— blade 未注入 window.settings
              </Typography.Text>
            ),
          },
          {
            key: 'apiBase',
            label: '管理 API 基址',
            children: <Typography.Text code>{adminApiBase}</Typography.Text>,
          },
          {
            key: 'uiBase',
            label: '界面路由基址',
            children: <Typography.Text code>{uiBasePath}</Typography.Text>,
          },
          {
            key: 'endpoints',
            label: '已登记接口数',
            children: `${ENDPOINT_COUNT} 个`,
          },
        ]}
      />
    </Card>
  )
}
