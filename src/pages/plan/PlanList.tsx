import { useState } from 'react'
import {
  Button,
  Card,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dropPlan,
  fetchPlans,
  RESET_TRAFFIC_METHODS,
  sortPlans,
  updatePlanFlags,
  type AdminPlan,
} from '@/api/plan'
import { formatMoney } from '@/lib/format'
import PlanEditModal from './PlanEditModal'

const PRICE_COLUMNS: { key: keyof AdminPlan; label: string }[] = [
  { key: 'month_price', label: '月付' },
  { key: 'quarter_price', label: '季付' },
  { key: 'half_year_price', label: '半年' },
  { key: 'year_price', label: '年付' },
  { key: 'two_year_price', label: '两年' },
  { key: 'three_year_price', label: '三年' },
  { key: 'onetime_price', label: '一次性' },
  { key: 'reset_price', label: '重置包' },
]

export default function PlanList() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<AdminPlan | null | undefined>(undefined)

  const { data: plans, isFetching } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
  })

  const reload = () => qc.invalidateQueries({ queryKey: ['plans'] })

  const sortMutation = useMutation({
    mutationFn: sortPlans,
    onSuccess: () => {
      message.success('顺序已保存')
      reload()
    },
  })

  /** 上下移动。后端 sort 接口要传**全量顺序**，不是只传变动项。 */
  function move(index: number, delta: number) {
    if (!plans) return
    const next = [...plans]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const a = next[index]!
    const b = next[target]!
    next[index] = b
    next[target] = a
    sortMutation.mutate(next.map((p) => p.id))
  }

  function confirmDrop(row: AdminPlan) {
    Modal.confirm({
      title: `删除套餐「${row.name}」？`,
      content:
        '后端会先检查：该套餐下若还有订单或用户，会拒绝删除。当前该套餐有 ' +
        `${row.count} 个有效用户。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await dropPlan(row.id)
        message.success('套餐已删除')
        reload()
      },
    })
  }

  return (
    <>
      <Card
        title={
          <Space>
            <span>套餐管理</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              流量单位是 GB，价格单位是元（后端存分）
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditing(null)}
            >
              新增套餐
            </Button>
          </Space>
        }
      >
        <Table<AdminPlan>
          rowKey="id"
          loading={isFetching || sortMutation.isPending}
          dataSource={plans ?? []}
          pagination={false}
          scroll={{ x: 1500 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 64, fixed: 'left' },
            {
              title: '名称',
              dataIndex: 'name',
              width: 160,
              fixed: 'left',
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <span>{row.name}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    权限组 #{row.group_id}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: '有效用户',
              dataIndex: 'count',
              width: 90,
              render: (v: number) => <Tag color={v > 0 ? 'blue' : 'default'}>{v}</Tag>,
            },
            {
              title: '流量',
              dataIndex: 'transfer_enable',
              width: 90,
              render: (v: number) => `${v} GB`,
            },
            {
              title: '设备数',
              dataIndex: 'device_limit',
              width: 80,
              render: (v: number | null) => v ?? '不限',
            },
            {
              title: '限速',
              dataIndex: 'speed_limit',
              width: 90,
              render: (v: number | null) => (v ? `${v} Mbps` : '不限'),
            },
            {
              title: '容量上限',
              dataIndex: 'capacity_limit',
              width: 90,
              render: (v: number | null) => v ?? '不限',
            },
            {
              title: '流量重置',
              dataIndex: 'reset_traffic_method',
              width: 120,
              render: (v: number | null) =>
                v === null
                  ? '跟随全局'
                  : (RESET_TRAFFIC_METHODS[
                      v as keyof typeof RESET_TRAFFIC_METHODS
                    ] ?? v),
            },
            ...PRICE_COLUMNS.map((c) => ({
              title: c.label,
              dataIndex: c.key as string,
              width: 90,
              render: (v: number | null) =>
                v === null || v === undefined ? (
                  <Typography.Text type="secondary">—</Typography.Text>
                ) : (
                  formatMoney(v)
                ),
            })),
            {
              title: '上架',
              dataIndex: 'show',
              width: 70,
              fixed: 'right',
              render: (_, row) => (
                <Switch
                  size="small"
                  checked={row.show === 1}
                  onChange={async (checked) => {
                    await updatePlanFlags(row.id, { show: checked ? 1 : 0 })
                    message.success(checked ? '已上架' : '已下架')
                    reload()
                  }}
                />
              ),
            },
            {
              title: '可续费',
              dataIndex: 'renew',
              width: 80,
              fixed: 'right',
              render: (_, row) => (
                <Switch
                  size="small"
                  checked={row.renew === 1}
                  onChange={async (checked) => {
                    await updatePlanFlags(row.id, { renew: checked ? 1 : 0 })
                    message.success('已更新')
                    reload()
                  }}
                />
              ),
            },
            {
              title: '操作',
              width: 170,
              fixed: 'right',
              render: (_, row, index) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={index === (plans?.length ?? 0) - 1}
                    onClick={() => move(index, 1)}
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setEditing(row)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => confirmDrop(row)}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <PlanEditModal
        open={editing !== undefined}
        plan={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={reload}
      />
    </>
  )
}
