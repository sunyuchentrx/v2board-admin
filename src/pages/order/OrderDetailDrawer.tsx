import type { ReactNode } from 'react'
import {
  Descriptions,
  Drawer,
  Empty,
  Spin,
  Table,
  Tag,
  Typography,
  type DescriptionsProps,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import {
  COMMISSION_STATUS,
  getOrderDetail,
  ORDER_PERIODS,
  ORDER_STATUS,
  ORDER_TYPE,
} from '@/api/order'
import FormSection from '@/components/FormSection'
import { formatMoney, formatTime } from '@/lib/format'
import './OrderPage.css'

/*
 * 订单状态 / 佣金状态的标签颜色。列表和详情共用下面几个组件，保证同一状态全页同色。
 * 只导出组件（不导出常量），这样 Vite 的 Fast Refresh 仍能热替换这个文件。
 */
const ORDER_STATUS_COLOR: Record<number, string> = {
  0: 'warning', // 待支付
  1: 'processing', // 开通中
  2: 'default', // 已取消
  3: 'success', // 已完成
  4: 'purple', // 已折抵：已被新订单吸收，和「已取消」区分开
}

const COMMISSION_STATUS_COLOR: Record<number, string> = {
  0: 'warning', // 待确认
  1: 'processing', // 发放中
  2: 'success', // 已发放
  3: 'default', // 无效
}

export function OrderStatusTag({ status }: { status: number }) {
  return (
    <Tag
      bordered={false}
      color={ORDER_STATUS_COLOR[status] ?? 'default'}
      className="order-page-tag"
    >
      {ORDER_STATUS[status as keyof typeof ORDER_STATUS] ?? status}
    </Tag>
  )
}

export function CommissionStatusTag({
  status,
  color,
  icon,
  className,
  children,
}: {
  status: number
  /** 覆盖默认颜色（例如未完成订单却处于「发放中」时标红） */
  color?: string
  icon?: ReactNode
  className?: string
  /** 追加在状态名后面的内容（下拉箭头等） */
  children?: ReactNode
}) {
  return (
    <Tag
      bordered={false}
      color={color ?? COMMISSION_STATUS_COLOR[status] ?? 'default'}
      icon={icon}
      className={`order-page-tag${className ? ` ${className}` : ''}`}
    >
      {COMMISSION_STATUS[status as keyof typeof COMMISSION_STATUS] ?? status}
      {children}
    </Tag>
  )
}

/** 佣金状态下拉菜单里的小色点，与标签同色 */
export function CommissionStatusDot({ status }: { status: number }) {
  return (
    <span
      className={`order-page-dot is-${COMMISSION_STATUS_COLOR[status] ?? 'default'}`}
    />
  )
}

const EMPTY = <span className="order-page-empty">—</span>

/** 金额：0 元用次要色，让真正有值的几项跳出来（仍是真实数值，不用空值那种更淡的颜色） */
function money(cents: number | null | undefined) {
  return cents ? (
    <span className="order-page-money">{formatMoney(cents)}</span>
  ) : (
    <span className="order-page-zero tabular-nums">{formatMoney(0)}</span>
  )
}

function idText(id: number | null | undefined) {
  return id ? <span className="tabular-nums">#{id}</span> : EMPTY
}

/** 抽屉固定 720 宽，任何视口下都是两列（手机上一列）；antd 默认在 xl 以上会变成 3/4 列 */
const DETAIL_COLUMN = { xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }

function DetailList({ items = [] }: { items: DescriptionsProps['items'] }) {
  return (
    <Descriptions
      className="order-page-desc"
      size="small"
      colon={false}
      column={DETAIL_COLUMN}
      // 项数为奇数时让最后一项占满剩余列，否则 antd 会告警「span 之和与 column 不符」
      items={items.map((it, i) =>
        i === items.length - 1 && it.span === undefined ? { ...it, span: 'filled' } : it,
      )}
    />
  )
}

interface Props {
  orderId: number | null
  /**
   * 列表行里的套餐名。order/detail 不返回 plan_name（只有 fetch 列表才拼），
   * 由列表把现成的名字带过来，不为一个名字再请求一次套餐列表
   */
  planName?: string
  onClose: () => void
}

export default function OrderDetailDrawer({ orderId, planName, onClose }: Props) {
  const { data, isFetching } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: () => getOrderDetail(orderId!),
    enabled: orderId !== null,
  })

  let planLabel = '—'
  if (data?.type === 9) {
    // 充值单的 plan_id 是 0（User/OrderController 的 deposit 分支）
    planLabel = '余额充值'
  } else if (planName) {
    planLabel = planName
  } else if (data?.plan_id) {
    // 列表没带名字时退回显示套餐 ID
    planLabel = `套餐 #${data.plan_id}`
  }
  // 没有邀请人、也没有任何佣金数额：整块佣金信息都是 0，只留一句说明
  const noCommission =
    !!data &&
    !data.invite_user_id &&
    !data.commission_balance &&
    !data.actual_commission_balance

  return (
    <Drawer
      open={orderId !== null}
      onClose={onClose}
      width={720}
      rootClassName="order-page-drawer"
      title="订单详情"
      destroyOnHidden
    >
      <Spin spinning={isFetching}>
        <div className="order-page-detail-body">
          {data ? (
            <>
              <div className="order-page-hero">
                <div className="order-page-hero-main">
                  <span className="order-page-hero-label">订单号</span>
                  <Typography.Text
                    className="order-page-hero-no mono"
                    copyable={{ text: data.trade_no, tooltips: ['复制订单号', '已复制'] }}
                  >
                    {data.trade_no}
                  </Typography.Text>
                  <div className="order-page-hero-meta">
                    <OrderStatusTag status={data.status} />
                    <span>
                      {ORDER_TYPE[data.type as keyof typeof ORDER_TYPE] ?? data.type}
                    </span>
                    <span>·</span>
                    <span>{planLabel}</span>
                  </div>
                </div>
                <div className="order-page-hero-amount">
                  <span className="order-page-hero-label">应付金额</span>
                  <span className="order-page-hero-value">
                    {formatMoney(data.total_amount)}
                  </span>
                </div>
              </div>

              {/* 状态 / 类型 / 套餐 / 应付金额已经在上面的摘要里，下面各小节不再重复 */}
              <FormSection title="订单信息" first>
                <DetailList
                  items={[
                    { key: 'id', label: '订单 ID', children: <span className="tabular-nums">{data.id}</span> },
                    // 充值单的 period 是 deposit，没有对应的周期名（列表里同样不显示）
                    ...(data.type === 9
                      ? []
                      : [
                          {
                            key: 'period',
                            label: '周期',
                            children:
                              ORDER_PERIODS[data.period as keyof typeof ORDER_PERIODS] ??
                              data.period,
                          },
                        ]),
                    {
                      key: 'created',
                      label: '下单时间',
                      children: <span className="tabular-nums">{formatTime(data.created_at)}</span>,
                    },
                    {
                      key: 'paid_at',
                      label: '支付时间',
                      children: data.paid_at ? (
                        <span className="tabular-nums">{formatTime(data.paid_at)}</span>
                      ) : (
                        <Typography.Text type="secondary">未支付</Typography.Text>
                      ),
                    },
                    { key: 'payment', label: '支付方式 ID', children: idText(data.payment_id) },
                    {
                      key: 'callback',
                      label: '支付回调号',
                      // 最后一项：DetailList 会让它占满所在行的剩余列
                      children: data.callback_no ? (
                        <Typography.Text className="mono" copyable>
                          {data.callback_no}
                        </Typography.Text>
                      ) : (
                        EMPTY
                      ),
                    },
                  ]}
                />
              </FormSection>

              <FormSection title="用户">
                <DetailList
                  items={[
                    {
                      key: 'user',
                      label: '用户 ID',
                      children: (
                        <Typography.Text
                          className="tabular-nums"
                          copyable={{ text: String(data.user_id) }}
                        >
                          #{data.user_id}
                        </Typography.Text>
                      ),
                    },
                    { key: 'inviter', label: '邀请人 ID', children: idText(data.invite_user_id) },
                  ]}
                />
              </FormSection>

              <FormSection title="金额">
                <DetailList
                  items={[
                    { key: 'discount', label: '优惠金额', children: money(data.discount_amount) },
                    { key: 'coupon', label: '优惠券 ID', children: idText(data.coupon_id) },
                    { key: 'balance', label: '余额抵扣', children: money(data.balance_amount) },
                    { key: 'handling', label: '手续费', children: money(data.handling_amount) },
                    { key: 'surplus', label: '旧订单折抵', children: money(data.surplus_amount) },
                    { key: 'refund', label: '折抵退回余额', children: money(data.refund_amount) },
                  ]}
                />
              </FormSection>

              <FormSection title="佣金">
                {noCommission ? (
                  <div className="order-page-subtable-empty" style={{ marginBottom: 18 }}>
                    无邀请人，本单不产生佣金
                  </div>
                ) : (
                  <DetailList
                    items={[
                      { key: 'commission', label: '佣金', children: money(data.commission_balance) },
                      {
                        key: 'actual_commission',
                        label: '实发佣金',
                        children: money(data.actual_commission_balance),
                      },
                      {
                        key: 'commission_status',
                        label: '佣金状态',
                        children: data.invite_user_id ? (
                          <CommissionStatusTag status={data.commission_status} />
                        ) : (
                          <Typography.Text type="secondary">无邀请人</Typography.Text>
                        ),
                      },
                    ]}
                  />
                )}

                {data.commission_log && data.commission_log.length > 0 ? (
                  <div className="order-page-subtable" style={{ marginTop: 6, marginBottom: 18 }}>
                    <Table
                      size="small"
                      rowKey="id"
                      pagination={false}
                      dataSource={data.commission_log}
                      scroll={{ x: 'max-content' }}
                      columns={[
                        { title: 'ID', dataIndex: 'id', width: 64 },
                        {
                          title: '发放时间',
                          dataIndex: 'created_at',
                          width: 150,
                          render: (v: number) => (
                            <span className="tabular-nums order-page-nowrap">{formatTime(v)}</span>
                          ),
                        },
                        {
                          title: '受益人',
                          dataIndex: 'invite_user_id',
                          width: 96,
                          render: (v: number) => `#${v}`,
                        },
                        {
                          title: '订单金额',
                          dataIndex: 'order_amount',
                          width: 110,
                          align: 'right',
                          render: (v: number) => formatMoney(v),
                        },
                        {
                          title: '获得佣金',
                          dataIndex: 'get_amount',
                          width: 110,
                          align: 'right',
                          render: (v: number) => (
                            <span className="order-page-money">{formatMoney(v)}</span>
                          ),
                        },
                      ]}
                    />
                  </div>
                ) : data.invite_user_id ? (
                  <div className="order-page-subtable-empty" style={{ marginTop: 6, marginBottom: 18 }}>
                    暂无佣金发放记录
                  </div>
                ) : null}
              </FormSection>

              {data.surplus_orders && data.surplus_orders.length > 0 && (
                <FormSection
                  title="被本单折抵的旧订单"
                  description="变更订阅时，未用完的旧订单价值会折抵到新单。这些旧订单在开通后状态会被置为「已折抵」。"
                >
                  <div className="order-page-subtable" style={{ marginBottom: 8 }}>
                    <Table
                      size="small"
                      rowKey="id"
                      pagination={false}
                      dataSource={data.surplus_orders}
                      scroll={{ x: 'max-content' }}
                      columns={[
                        { title: 'ID', dataIndex: 'id', width: 64 },
                        {
                          title: '订单号',
                          dataIndex: 'trade_no',
                          ellipsis: true,
                          render: (v: string) => <span className="mono">{v}</span>,
                        },
                        {
                          title: '状态',
                          dataIndex: 'status',
                          width: 96,
                          render: (v: number) => <OrderStatusTag status={v} />,
                        },
                        {
                          title: '金额',
                          dataIndex: 'total_amount',
                          width: 110,
                          align: 'right',
                          render: (v: number) => formatMoney(v),
                        },
                      ]}
                    />
                  </div>
                </FormSection>
              )}
            </>
          ) : (
            !isFetching && <Empty description="订单不存在" />
          )}
        </div>
      </Spin>
    </Drawer>
  )
}
