import { useRef, useState } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import { Button, Modal, Space, Switch, Tag, Typography, message } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import {
  COUPON_TYPES,
  dropCoupon,
  toggleCouponShow,
  type AdminCoupon,
} from '@/api/promo'
import { formatMoney, formatTime } from '@/lib/format'
import CouponEditModal from './CouponEditModal'

/** limit_plan_ids / limit_period 在库里是 varchar，可能是 JSON 字符串也可能已被解析成数组 */
function asArray(value: unknown): (string | number)[] {
  if (Array.isArray(value)) return value as (string | number)[]
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : [value]
    } catch {
      return [value]
    }
  }
  return []
}

export default function CouponList() {
  const tableRef = useRef<ActionType>(null)
  const [editing, setEditing] = useState<AdminCoupon | null | undefined>(undefined)

  const reload = () => tableRef.current?.reload()

  return (
    <>
      <ProTable<AdminCoupon>
        actionRef={tableRef}
        rowKey="id"
        request={async (params, sort) =>
          proTableRequest<AdminCoupon>(
            ADMIN_ENDPOINTS.coupon.fetch,
            { current: params.current, pageSize: params.pageSize },
            sort as Record<string, 'ascend' | 'descend' | null>,
          ) as Promise<{ data: AdminCoupon[]; total: number; success: boolean }>
        }
        columns={[
          { title: 'ID', dataIndex: 'id', width: 64, sorter: true },
          { title: '名称', dataIndex: 'name', width: 150, ellipsis: true },
          {
            title: '券码',
            dataIndex: 'code',
            width: 150,
            render: (_, row) => (
              <Typography.Text copyable={{ text: row.code }} code>
                {row.code}
              </Typography.Text>
            ),
          },
          {
            title: '类型 / 面值',
            dataIndex: 'type',
            width: 140,
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Tag color={row.type === 1 ? 'blue' : 'green'}>
                  {COUPON_TYPES[row.type as keyof typeof COUPON_TYPES] ?? row.type}
                </Tag>
                {/* type=1 存的是分，type=2 存的是百分比整数 */}
                <span>{row.type === 1 ? formatMoney(row.value) : `${row.value}%`}</span>
              </Space>
            ),
          },
          {
            title: '使用限制',
            width: 160,
            render: (_, row) => (
              <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
                <span>总次数：{row.limit_use ?? '不限'}</span>
                <span>每人：{row.limit_use_with_user ?? '不限'}</span>
              </Space>
            ),
          },
          {
            title: '限定范围',
            width: 170,
            render: (_, row) => {
              const plans = asArray(row.limit_plan_ids)
              const periods = asArray(row.limit_period)
              if (plans.length === 0 && periods.length === 0) {
                return <Typography.Text type="secondary">不限</Typography.Text>
              }
              return (
                <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
                  {plans.length > 0 && <span>套餐：{plans.join(', ')}</span>}
                  {periods.length > 0 && <span>周期：{periods.join(', ')}</span>}
                </Space>
              )
            },
          },
          {
            title: '有效期',
            width: 200,
            render: (_, row) => (
              <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
                <span>{formatTime(row.started_at)}</span>
                <span>至 {formatTime(row.ended_at)}</span>
              </Space>
            ),
          },
          {
            title: '启用',
            dataIndex: 'show',
            width: 70,
            render: (_, row) => (
              <Switch
                size="small"
                checked={row.show === 1}
                onChange={async () => {
                  // 后端是取反，不接受目标值
                  await toggleCouponShow(row.id)
                  message.success('已更新')
                  reload()
                }}
              />
            ),
          },
          {
            title: '操作',
            valueType: 'option',
            width: 130,
            fixed: 'right',
            render: (_, row) => [
              <Button
                key="edit"
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => setEditing(row)}
              >
                编辑
              </Button>,
              <Button
                key="del"
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  Modal.confirm({
                    title: `删除优惠券「${row.name}」？`,
                    content: '已使用过的记录不会回滚，只是这张券今后不能再用。',
                    okText: '确认删除',
                    okButtonProps: { danger: true },
                    onOk: async () => {
                      await dropCoupon(row.id)
                      message.success('已删除')
                      reload()
                    },
                  })
                }
              />,
            ],
          },
        ]}
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 张券`,
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        scroll={{ x: 1300 }}
        headerTitle="优惠券"
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>,
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setEditing(null)}
          >
            新增 / 批量生成
          </Button>,
        ]}
      />

      <CouponEditModal
        open={editing !== undefined}
        coupon={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={reload}
      />
    </>
  )
}
