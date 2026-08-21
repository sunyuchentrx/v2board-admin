import { useCallback, useRef, useState } from 'react'
import ProTable, { type ActionType, type ProColumns } from '@ant-design/pro-table'
import {
  Button,
  Checkbox,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import {
  cancelOrder,
  COMMISSION_STATUS,
  EDITABLE_COMMISSION_STATUS,
  markOrderPaid,
  ORDER_FILTER_CONDITIONS,
  ORDER_PERIODS,
  ORDER_STATUS,
  ORDER_TYPE,
  updateOrderCommissionStatus,
  type AdminOrder,
  type OrderFilter,
  type OrderFilterKey,
} from '@/api/order'
import FilterBar, { type FilterFieldConfig } from '@/components/FilterBar'
import { formatMoney, formatTime } from '@/lib/format'
import OrderDetailDrawer from './OrderDetailDrawer'
import OrderAssignModal from './OrderAssignModal'

/** 过滤字段配置。键白名单来自 OrderFetch.php；email 键因后端实现有误故不提供。 */
const FILTER_FIELDS: readonly FilterFieldConfig<OrderFilterKey>[] = [
  { key: 'trade_no', label: '订单号', input: 'text' },
  {
    key: 'status',
    label: '订单状态',
    input: 'select',
    options: Object.entries(ORDER_STATUS).map(([v, l]) => ({
      value: v,
      label: l,
    })),
  },
  {
    key: 'commission_status',
    label: '佣金状态',
    input: 'select',
    options: Object.entries(COMMISSION_STATUS).map(([v, l]) => ({
      value: v,
      label: l,
    })),
  },
  { key: 'user_id', label: '用户 ID', input: 'number' },
  { key: 'invite_user_id', label: '邀请人 ID', input: 'number' },
  { key: 'callback_no', label: '支付回调号', input: 'text' },
  { key: 'commission_balance', label: '佣金额(分)', input: 'number' },
]

const STATUS_COLOR: Record<number, string> = {
  0: 'orange',
  1: 'processing',
  2: 'default',
  3: 'success',
  4: 'purple',
}

export default function OrderList() {
  const tableRef = useRef<ActionType>(null)
  const [filters, setFilters] = useState<OrderFilter[]>([])
  const [commissionOnly, setCommissionOnly] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)

  const reload = useCallback(() => tableRef.current?.reload(), [])

  function confirmPaid(row: AdminOrder) {
    Modal.confirm({
      title: `将订单 ${row.trade_no} 标记为已支付？`,
      content: (
        <>
          <p>
            这会按<strong>真实付款</strong>处理这张订单：立即为用户开通订阅、
            计入统计、并按规则派发邀请佣金。回调号会记为 manual_operation。
          </p>
          <p style={{ marginBottom: 0 }}>
            应付金额 {formatMoney(row.total_amount)}
            {row.balance_amount ? `（另有余额抵扣 ${formatMoney(row.balance_amount)}）` : ''}
          </p>
        </>
      ),
      okText: '确认标记为已支付',
      width: 520,
      onOk: async () => {
        await markOrderPaid(row.trade_no)
        message.success('已标记为支付')
        reload()
      },
    })
  }

  function confirmCancel(row: AdminOrder) {
    Modal.confirm({
      title: `取消订单 ${row.trade_no}？`,
      content: row.balance_amount
        ? `该订单用余额抵扣了 ${formatMoney(row.balance_amount)}，取消后会退回用户余额。`
        : '取消后订单不可再支付，用户需重新下单。',
      okText: '确认取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await cancelOrder(row.trade_no)
        message.success('订单已取消')
        reload()
      },
    })
  }

  const columns: ProColumns<AdminOrder>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, fixed: 'left' },
    {
      title: '订单号',
      dataIndex: 'trade_no',
      width: 190,
      fixed: 'left',
      render: (_, row) => (
        <Typography.Text copyable={{ text: row.trade_no }} style={{ fontSize: 12 }}>
          {row.trade_no}
        </Typography.Text>
      ),
    },
    {
      title: '用户',
      dataIndex: 'user_id',
      width: 90,
      render: (_, row) => (
        <Typography.Text copyable={{ text: String(row.user_id) }}>
          #{row.user_id}
        </Typography.Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (_, row) => (
        <Tag color={STATUS_COLOR[row.status] ?? 'default'}>
          {ORDER_STATUS[row.status as keyof typeof ORDER_STATUS] ?? row.status}
        </Tag>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (_, row) =>
        ORDER_TYPE[row.type as keyof typeof ORDER_TYPE] ?? row.type,
    },
    {
      title: '套餐 / 周期',
      dataIndex: 'plan_name',
      width: 170,
      ellipsis: true,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.plan_name ?? (row.type === 9 ? '余额充值' : '—')}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {ORDER_PERIODS[row.period as keyof typeof ORDER_PERIODS] ?? row.period}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '金额',
      dataIndex: 'total_amount',
      width: 150,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{formatMoney(row.total_amount)}</span>
          {/* 把抵扣/折扣拆开显示，否则「应付 0 元」看起来像 bug */}
          {row.balance_amount ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              余额抵扣 {formatMoney(row.balance_amount)}
            </Typography.Text>
          ) : null}
          {row.discount_amount ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              优惠 {formatMoney(row.discount_amount)}
            </Typography.Text>
          ) : null}
          {row.surplus_amount ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              折抵 {formatMoney(row.surplus_amount)}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '佣金',
      dataIndex: 'commission_balance',
      width: 160,
      render: (_, row) => {
        if (!row.invite_user_id) {
          return <Typography.Text type="secondary">无邀请人</Typography.Text>
        }
        // 只有 0/1/3 能改；已发放(2) 后端的 OrderUpdate 白名单不含，改不回来
        const editable = (
          EDITABLE_COMMISSION_STATUS as readonly number[]
        ).includes(row.commission_status)
        return (
          <Space direction="vertical" size={2}>
            <span>{formatMoney(row.commission_balance)}</span>
            {editable ? (
              <Select<0 | 1 | 3>
                size="small"
                style={{ width: 96 }}
                value={row.commission_status as 0 | 1 | 3}
                options={EDITABLE_COMMISSION_STATUS.map((s) => ({
                  value: s,
                  label: COMMISSION_STATUS[s],
                }))}
                onChange={async (v) => {
                  await updateOrderCommissionStatus(row.trade_no, v)
                  message.success('佣金状态已更新')
                  reload()
                }}
              />
            ) : (
              // 已发放(2) 后端不允许改回（OrderUpdate 的 in:0,1,3 不含 2）
              <Tag color="success">
                {COMMISSION_STATUS[
                  row.commission_status as keyof typeof COMMISSION_STATUS
                ] ?? row.commission_status}
              </Tag>
            )}
          </Space>
        )
      },
    },
    {
      title: '支付时间',
      dataIndex: 'paid_at',
      width: 150,
      render: (_, row) => formatTime(row.paid_at, '未支付'),
    },
    {
      title: '下单时间',
      dataIndex: 'created_at',
      width: 150,
      render: (_, row) => formatTime(row.created_at),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 190,
      fixed: 'right',
      render: (_, row) => {
        const actions = [
          <Button
            key="detail"
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setDetailId(row.id)}
          >
            详情
          </Button>,
        ]
        // paid / cancel 后端都只接受 status=0，其他状态不显示按钮而不是点了报错
        if (row.status === 0) {
          actions.push(
            <Button
              key="paid"
              type="link"
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => confirmPaid(row)}
            >
              标记支付
            </Button>,
            <Button
              key="cancel"
              type="link"
              size="small"
              danger
              icon={<CloseCircleOutlined />}
              onClick={() => confirmCancel(row)}
            >
              取消
            </Button>,
          )
        }
        return actions
      },
    },
  ]

  return (
    <>
      <FilterBar<OrderFilterKey>
        fields={FILTER_FIELDS}
        conditions={ORDER_FILTER_CONDITIONS}
        value={filters}
        onChange={(f) => setFilters(f as OrderFilter[])}
        onSearch={reload}
        extra={
          <Checkbox
            checked={commissionOnly}
            onChange={(e) => {
              setCommissionOnly(e.target.checked)
              // 这个开关直接影响查询条件，勾选即刷新，不用再点查询
              setTimeout(reload, 0)
            }}
          >
            只看有佣金的订单
          </Checkbox>
        }
      />

      <ProTable<AdminOrder>
        actionRef={tableRef}
        rowKey="id"
        columns={columns}
        request={async (params) =>
          proTableRequest<AdminOrder>(ADMIN_ENDPOINTS.order.fetch, {
            current: params.current,
            pageSize: params.pageSize,
            filter: filters.length > 0 ? filters : undefined,
            ...(commissionOnly ? { is_commission: 1 } : {}),
          }) as Promise<{ data: AdminOrder[]; total: number; success: boolean }>
        }
        // 后端 fetch 硬编码 orderBy('created_at','DESC') 且忽略 sort 参数，
        // 所以列上一律不开 sorter —— 开了点击没反应更糟
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 张订单`,
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        scroll={{ x: 1600 }}
        headerTitle={
          <Space>
            <span>订单管理</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              固定按下单时间倒序（后端不支持排序）
            </Typography.Text>
          </Space>
        }
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>,
          <Button
            key="assign"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAssignOpen(true)}
          >
            手动开单
          </Button>,
        ]}
      />

      <OrderDetailDrawer
        orderId={detailId}
        onClose={() => setDetailId(null)}
      />

      <OrderAssignModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onDone={reload}
      />
    </>
  )
}
