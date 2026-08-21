import { Descriptions, Drawer, Empty, Spin, Table, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import {
  COMMISSION_STATUS,
  getOrderDetail,
  ORDER_PERIODS,
  ORDER_STATUS,
  ORDER_TYPE,
} from '@/api/order'
import { formatMoney, formatTime } from '@/lib/format'

interface Props {
  orderId: number | null
  onClose: () => void
}

export default function OrderDetailDrawer({ orderId, onClose }: Props) {
  const { data, isFetching } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: () => getOrderDetail(orderId!),
    enabled: orderId !== null,
  })

  return (
    <Drawer
      open={orderId !== null}
      onClose={onClose}
      width={720}
      title={data ? `订单 ${data.trade_no}` : '订单详情'}
      destroyOnClose
    >
      <Spin spinning={isFetching}>
        {data ? (
          <>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: 'id', label: '订单 ID', children: data.id },
                {
                  key: 'status',
                  label: '状态',
                  children: (
                    <Tag>
                      {ORDER_STATUS[data.status as keyof typeof ORDER_STATUS] ??
                        data.status}
                    </Tag>
                  ),
                },
                {
                  key: 'type',
                  label: '类型',
                  children:
                    ORDER_TYPE[data.type as keyof typeof ORDER_TYPE] ?? data.type,
                },
                {
                  key: 'period',
                  label: '周期',
                  children:
                    ORDER_PERIODS[data.period as keyof typeof ORDER_PERIODS] ??
                    data.period,
                },
                { key: 'user', label: '用户 ID', children: `#${data.user_id}` },
                {
                  key: 'plan',
                  label: '套餐',
                  children: data.plan_name ?? '—',
                },
                {
                  key: 'total',
                  label: '应付金额',
                  children: formatMoney(data.total_amount),
                },
                {
                  key: 'handling',
                  label: '手续费',
                  children: formatMoney(data.handling_amount ?? 0),
                },
                {
                  key: 'discount',
                  label: '优惠金额',
                  children: formatMoney(data.discount_amount ?? 0),
                },
                {
                  key: 'balance',
                  label: '余额抵扣',
                  children: formatMoney(data.balance_amount ?? 0),
                },
                {
                  key: 'surplus',
                  label: '旧订单折抵',
                  children: formatMoney(data.surplus_amount ?? 0),
                },
                {
                  key: 'refund',
                  label: '折抵退回余额',
                  children: formatMoney(data.refund_amount ?? 0),
                },
                {
                  key: 'callback',
                  label: '支付回调号',
                  children: data.callback_no ?? '—',
                },
                {
                  key: 'payment',
                  label: '支付方式 ID',
                  children: data.payment_id ?? '—',
                },
                {
                  key: 'paid_at',
                  label: '支付时间',
                  children: formatTime(data.paid_at, '未支付'),
                },
                {
                  key: 'created',
                  label: '下单时间',
                  children: formatTime(data.created_at),
                },
                {
                  key: 'inviter',
                  label: '邀请人 ID',
                  children: data.invite_user_id ? `#${data.invite_user_id}` : '—',
                },
                {
                  key: 'commission',
                  label: '佣金',
                  children: `${formatMoney(data.commission_balance)}（${
                    COMMISSION_STATUS[
                      data.commission_status as keyof typeof COMMISSION_STATUS
                    ] ?? data.commission_status
                  }）`,
                },
                {
                  key: 'actual_commission',
                  label: '实发佣金',
                  children: formatMoney(data.actual_commission_balance ?? 0),
                },
                {
                  key: 'coupon',
                  label: '优惠券 ID',
                  children: data.coupon_id ?? '—',
                },
              ]}
            />

            {data.surplus_orders && data.surplus_orders.length > 0 && (
              <>
                <Typography.Title level={5} style={{ marginTop: 20 }}>
                  被本单折抵的旧订单
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  变更订阅时，未用完的旧订单价值会折抵到新单。这些旧订单在开通后
                  状态会被置为「已折抵」。
                </Typography.Paragraph>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={data.surplus_orders}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 70 },
                    { title: '订单号', dataIndex: 'trade_no', ellipsis: true },
                    {
                      title: '金额',
                      dataIndex: 'total_amount',
                      width: 100,
                      render: (v: number) => formatMoney(v),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 90,
                      render: (v: number) =>
                        ORDER_STATUS[v as keyof typeof ORDER_STATUS] ?? v,
                    },
                  ]}
                />
              </>
            )}

            {data.commission_log && data.commission_log.length > 0 && (
              <>
                <Typography.Title level={5} style={{ marginTop: 20 }}>
                  佣金发放记录
                </Typography.Title>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={data.commission_log}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 70 },
                    {
                      title: '受益人 ID',
                      dataIndex: 'invite_user_id',
                      width: 100,
                    },
                    {
                      title: '订单金额',
                      dataIndex: 'order_amount',
                      width: 100,
                      render: (v: number) => formatMoney(v),
                    },
                    {
                      title: '获得佣金',
                      dataIndex: 'get_amount',
                      width: 100,
                      render: (v: number) => formatMoney(v),
                    },
                    {
                      title: '时间',
                      dataIndex: 'created_at',
                      width: 150,
                      render: (v: number) => formatTime(v),
                    },
                  ]}
                />
              </>
            )}
          </>
        ) : (
          !isFetching && <Empty description="订单不存在" />
        )}
      </Spin>
    </Drawer>
  )
}
