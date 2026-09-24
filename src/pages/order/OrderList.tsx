import { useCallback, useRef, useState } from 'react'
import ProTable, {
  type ActionType,
  type ColumnsState,
  type ProColumns,
} from '@ant-design/pro-table'
import {
  Button,
  Checkbox,
  Dropdown,
  Grid,
  Modal,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  EyeOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import {
  cancelOrder,
  COMMISSION_EDITABLE_ORDER_STATUS,
  COMMISSION_STATUS,
  EDITABLE_COMMISSION_STATUS,
  getOrderDetail,
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
import RowActions from '@/components/RowActions'
import { formatMoney, formatTime } from '@/lib/format'
import OrderDetailDrawer, {
  CommissionStatusDot,
  CommissionStatusTag,
  OrderStatusTag,
} from './OrderDetailDrawer'
import OrderAssignModal from './OrderAssignModal'
import './OrderPage.css'

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

/** 佣金状态下拉里每个选项的一句话说明（与 changeCommissionStatus 里的处理一致） */
const COMMISSION_HINT: Record<(typeof EDITABLE_COMMISSION_STATUS)[number], string> = {
  0: '暂缓发放',
  1: '将真实打款',
  3: '作废',
}

type EditableCommissionStatus = (typeof EDITABLE_COMMISSION_STATUS)[number]

/** 给紧跟在右对齐数字列后面的左对齐列加一点左内边距（ProTable 是 middle 尺寸，默认内边距只有 8px） */
const gapAfterNumber = () => ({ style: { paddingInlineStart: 24 } })

type ColumnsStateMap = Record<string, ColumnsState>

/**
 * 断点决定 ID / 操作两列固不固定（键是下面列定义里的 dataIndex 'id' 和 key 'option'）。
 * 只改这两列的 fixed，用户在列设置里调过的显隐、顺序原样保留。
 */
function withPinned(map: ColumnsStateMap, pinned: boolean): ColumnsStateMap {
  return {
    ...map,
    id: { ...map.id, fixed: pinned ? 'left' : undefined },
    option: { ...map.option, fixed: pinned ? 'right' : undefined },
  }
}

/** 确认框正文第一行的订单号。放在标题里会把 26 位的订单号连同标题一起折成两三行 */
function ConfirmTradeNo({ tradeNo }: { tradeNo: string }) {
  return (
    <div className="order-page-confirm-no">
      <span className="order-page-confirm-no-label">订单号</span>
      <Typography.Text
        className="mono"
        copyable={{ text: tradeNo, tooltips: ['复制订单号', '已复制'] }}
      >
        {tradeNo}
      </Typography.Text>
    </div>
  )
}

export default function OrderList() {
  const tableRef = useRef<ActionType>(null)
  const [filters, setFilters] = useState<OrderFilter[]>([])
  const [commissionOnly, setCommissionOnly] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  /** order/detail 不带 plan_name，打开详情时把列表行里现成的套餐名一起带过去，不再多查一次套餐 */
  const [detailPlanName, setDetailPlanName] = useState<string | undefined>()
  const [assignOpen, setAssignOpen] = useState(false)
  /** 正在改佣金状态的订单（trade_no）。请求 + 刷新完成前禁用该行的下拉，防止连点 */
  const [commissionPending, setCommissionPending] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const reload = useCallback(() => tableRef.current?.reload(), [])
  // 手机上不固定列：左右两侧的固定列会把 390px 宽的表格占满，中间的列根本看不到。
  // useBreakpoint 首次渲染返回 {}，先用 matchMedia 同步判断。
  // ProTable 只在挂载时从列定义读一次 fixed、之后以列设置状态为准，所以把列设置状态受控：
  // 断点变了只改 ID / 操作两列的 fixed。不能靠换 key 重新挂载 —— 那样会丢页码、pageSize 和列设置，还会重新请求
  const screens = Grid.useBreakpoint()
  const pinned = screens.md ?? window.matchMedia('(min-width: 768px)').matches
  const [columnsState, setColumnsState] = useState<ColumnsStateMap>(() =>
    withPinned({}, pinned),
  )
  const [pinnedFor, setPinnedFor] = useState(pinned)
  if (pinnedFor !== pinned) {
    // 渲染期间按新断点调整状态（React 推荐的写法，比 useEffect 少一次用旧值渲染）
    setPinnedFor(pinned)
    setColumnsState((s) => withPinned(s, pinned))
  }

  async function applyCommissionStatus(
    row: AdminOrder,
    next: EditableCommissionStatus,
  ) {
    setCommissionPending((s) => new Set(s).add(row.trade_no))
    try {
      // 写之前按主键重读一次订单，确认 row 不是旧数据。order/update 是无条件覆盖
      // （不带「当前值 = 期望旧值」条件，也不拦从 2 改出），而 check:commission 每 15 分钟
      // 会把 1 CAS 成 2 并打款、autoCheck 会把完成满 3 天的 0 推到 1。列表停留期间只要跑过
      // 一轮，对着旧画面把实际已是 2 的单改回 0/1，定时任务就会再打一次款；改成 3 则会把
      // 已打出去的佣金标成「无效」，让人误以为拦住了。
      // 重读只是把竞态窗口从「列表停留时长」缩到毫秒级；根治要靠后端做条件更新。
      // Number()：Order 模型只 cast 了 status，commission_status 是裸列，别让 "2" !== 2 这种类型差把判断带偏
      const fresh = await getOrderDetail(row.id)
      if (
        Number(fresh.status) !== Number(row.status) ||
        Number(fresh.commission_status) !== Number(row.commission_status)
      ) {
        message.warning(
          Number(fresh.commission_status) === 2
            ? '该订单佣金已被定时任务发放（已发放），本次未做修改，列表已刷新'
            : '订单或佣金状态已变化，本次未做修改，列表已刷新，请重新确认',
        )
        return
      }
      // 已有佣金发放记录却不是 2：只可能是之前被人手动从「已发放」改回来过（后端不拦）。
      // 这时再设成 1，下一轮定时任务会照样再打一次款（autoPayCommission 不看 commission_log），
      // 与确认框里「下一轮才会打款」的前提不符，直接拒绝
      const paidLogs = fresh.commission_log ?? []
      if (next === 1 && paidLogs.length > 0) {
        message.error(
          `该订单已有 ${paidLogs.length} 条佣金发放记录（共 ${formatMoney(
            paidLogs.reduce((sum, l) => sum + Number(l.get_amount), 0),
          )}），再设为「发放中」会重复打款，本次未做修改`,
        )
        return
      }
      await updateOrderCommissionStatus(row.trade_no, next)
      message.success('佣金状态已更新')
    } catch {
      // 拦截器已提示（重读失败时不会发写请求）。写请求超时的话后端可能已经写入了，下面照样刷新看真实状态
    } finally {
      // 等列表刷新回来再解除禁用：否则下拉会短暂显示旧值且可再次操作
      await reload()
      setCommissionPending((s) => {
        const n = new Set(s)
        n.delete(row.trade_no)
        return n
      })
    }
  }

  function changeCommissionStatus(row: AdminOrder, next: EditableCommissionStatus) {
    // 改成 0 / 3 只是暂缓或作废，不会动钱，直接改；改成 1 会真实打款，必须确认
    if (next !== 1) {
      void applyCommissionStatus(row, next)
      return
    }
    Modal.confirm({
      title: '将佣金设为「发放中」？',
      content: (
        <>
          <ConfirmTradeNo tradeNo={row.trade_no} />
          <p>
            佣金 <strong>{formatMoney(row.commission_balance)}</strong>，受益邀请人{' '}
            <strong>#{row.invite_user_id}</strong>（订单用户 #{row.user_id}，
            订单金额 {formatMoney(row.total_amount)}）。
          </p>
          <p>
            下一轮 check:commission 定时任务（每 15 分钟一次）就会把这笔佣金
            <strong>真实打进邀请人账户</strong>（佣金余额；开启了「关闭提现」时直接进账户余额），
            并<strong>跳过 3 天的自动审核期</strong> —— 这段审核期本来是留给退款/拒付的。
          </p>
          <p style={{ marginBottom: 0 }}>
            若开启了三级分销，会按比例分给最多三级上线。打款后状态变为「已发放」，无法撤回。
          </p>
        </>
      ),
      okText: '确认发放',
      okButtonProps: { danger: true },
      // 会真实打款：默认焦点放在取消上，误按回车不会直接发放
      autoFocusButton: 'cancel',
      width: 520,
      onOk: () => applyCommissionStatus(row, 1),
    })
  }

  function confirmRevokeCommission(row: AdminOrder) {
    Modal.confirm({
      title: '撤回这笔佣金发放？',
      content: (
        <>
          <ConfirmTradeNo tradeNo={row.trade_no} />
          <p style={{ marginBottom: 0 }}>
            该订单尚未完成，却处于「发放中」，下一轮定时任务会给没收到的钱派佣{' '}
            {formatMoney(row.commission_balance)}（邀请人 #{row.invite_user_id}）。
            撤回为「待确认」后，订单完成并过了审核期才会自动发放。
          </p>
        </>
      ),
      okText: '撤回为待确认',
      width: 520,
      onOk: () => applyCommissionStatus(row, 0),
    })
  }

  function confirmPaid(row: AdminOrder) {
    Modal.confirm({
      title: '将这张订单标记为已支付？',
      content: (
        <>
          <ConfirmTradeNo tradeNo={row.trade_no} />
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
      // 会立即开通订阅并派佣：默认焦点放在取消上，误按回车不会直接生效
      autoFocusButton: 'cancel',
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
      title: '取消这张订单？',
      content: (
        <>
          <ConfirmTradeNo tradeNo={row.trade_no} />
          <p style={{ marginBottom: 0 }}>
            {row.balance_amount
              ? `该订单用余额抵扣了 ${formatMoney(row.balance_amount)}，取消后会退回用户余额。`
              : '取消后订单不可再支付，用户需重新下单。'}
          </p>
        </>
      ),
      okText: '确认取消',
      // 「取消」和「确认取消」并排容易看混，关闭按钮叫「返回」；焦点默认也放在它上面
      cancelText: '返回',
      autoFocusButton: 'cancel',
      okButtonProps: { danger: true },
      width: 520,
      onOk: async () => {
        await cancelOrder(row.trade_no)
        message.success('订单已取消')
        reload()
      },
    })
  }

  function renderCommissionStatus(row: AdminOrder) {
    if (!row.invite_user_id) {
      return <span className="order-page-sub">无邀请人</span>
    }
    const pending = commissionPending.has(row.trade_no)
    // 订单必须已完成/已折抵才允许改佣金（原因见 COMMISSION_EDITABLE_ORDER_STATUS 的注释）
    const orderSettled = (
      COMMISSION_EDITABLE_ORDER_STATUS as readonly number[]
    ).includes(row.status)
    // 已发放(2) 后端的 OrderUpdate 白名单（in:0,1,3）不含，改不回来
    const statusEditable = (
      EDITABLE_COMMISSION_STATUS as readonly number[]
    ).includes(row.commission_status)

    if (orderSettled && statusEditable) {
      const current =
        COMMISSION_STATUS[row.commission_status as keyof typeof COMMISSION_STATUS]
      return (
        <Dropdown
          trigger={['click']}
          disabled={pending}
          menu={{
            selectable: true,
            selectedKeys: [String(row.commission_status)],
            items: EDITABLE_COMMISSION_STATUS.map((s) => ({
              key: String(s),
              label: (
                <span className="order-page-menu-item">
                  <CommissionStatusDot status={s} />
                  <span>{COMMISSION_STATUS[s]}</span>
                  <span className="order-page-menu-hint">{COMMISSION_HINT[s]}</span>
                </span>
              ),
            })),
            onClick: ({ key }) => {
              const next = Number(key) as EditableCommissionStatus
              // 和原来的 Select 一样：点当前值不算修改，不发请求
              if (next === Number(row.commission_status)) return
              changeCommissionStatus(row, next)
            },
          }}
        >
          <button
            type="button"
            className="order-page-status-trigger"
            disabled={pending}
            aria-haspopup="menu"
            aria-label={`佣金状态：${current}，点击修改`}
          >
            <CommissionStatusTag
              status={row.commission_status}
              icon={pending ? <LoadingOutlined /> : undefined}
            >
              <DownOutlined className="order-page-caret" />
            </CommissionStatusTag>
          </button>
        </Dropdown>
      )
    }
    if (!orderSettled && row.commission_status === 1) {
      // 未完成订单却在「发放中」：旧版后台可以随便改，历史数据里可能有。
      // 给一个撤回口子 —— 改回 0 是安全的，autoCheck 只会在订单完成后再推进到 1
      return (
        <span className="order-page-commission">
          <Tooltip title="订单尚未完成，下一轮定时任务仍会给这笔没收到的钱派佣">
            <span className="order-page-commission">
              <CommissionStatusTag
                status={row.commission_status}
                color="error"
                className="is-help"
              />
            </span>
          </Tooltip>
          <Button
            type="link"
            size="small"
            danger
            loading={pending}
            onClick={() => confirmRevokeCommission(row)}
          >
            撤回
          </Button>
        </span>
      )
    }
    if (!orderSettled) {
      return (
        <Tooltip
          title={`订单${
            ORDER_STATUS[row.status as keyof typeof ORDER_STATUS] ?? row.status
          }，完成后才能手动修改佣金状态`}
        >
          <span className="order-page-commission">
            <CommissionStatusTag status={row.commission_status} className="is-help" />
          </span>
        </Tooltip>
      )
    }
    return <CommissionStatusTag status={row.commission_status} />
  }

  const columns: ProColumns<AdminOrder>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 72,
      fixed: pinned ? 'left' : undefined,
      render: (_, row) => <span className="tabular-nums">{row.id}</span>,
    },
    {
      // 用户 ID 放在订单号下面当第二行，省出一整列，1280 宽时金额也能露出来
      title: '订单 / 用户',
      dataIndex: 'trade_no',
      width: 208,
      render: (_, row) => (
        <div className="order-page-stack">
          <Typography.Text
            className="mono order-page-trade-no"
            copyable={{ text: row.trade_no, tooltips: ['复制订单号', '已复制'] }}
          >
            {row.trade_no}
          </Typography.Text>
          <Typography.Text
            className="order-page-sub order-page-user"
            copyable={{ text: String(row.user_id), tooltips: ['复制用户 ID', '已复制'] }}
          >
            用户 <span className="tabular-nums">#{row.user_id}</span>
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (_, row) => <OrderStatusTag status={row.status} />,
    },
    {
      title: '套餐 / 类型',
      dataIndex: 'plan_name',
      width: 160,
      render: (_, row) => {
        const plan = row.plan_name ?? (row.type === 9 ? '余额充值' : '—')
        const type = ORDER_TYPE[row.type as keyof typeof ORDER_TYPE] ?? row.type
        const period =
          ORDER_PERIODS[row.period as keyof typeof ORDER_PERIODS] ?? row.period
        return (
          <div className="order-page-stack">
            <span title={plan}>{plan}</span>
            {/* 充值单的 period 是 deposit，没有对应的周期名，只显示类型 */}
            <span className="order-page-sub">
              {row.type === 9 ? type : `${type} · ${period}`}
            </span>
          </div>
        )
      },
    },
    {
      title: '金额',
      dataIndex: 'total_amount',
      width: 128,
      align: 'right',
      render: (_, row) => (
        <div className="order-page-stack is-end">
          <span className="order-page-money">{formatMoney(row.total_amount)}</span>
          {/* 把抵扣/折扣拆开显示，否则「应付 0 元」看起来像 bug */}
          {row.balance_amount ? (
            <span className="order-page-sub">
              余额抵扣 {formatMoney(row.balance_amount)}
            </span>
          ) : null}
          {row.discount_amount ? (
            <span className="order-page-sub">
              优惠 {formatMoney(row.discount_amount)}
            </span>
          ) : null}
          {row.surplus_amount ? (
            <span className="order-page-sub">
              折抵 {formatMoney(row.surplus_amount)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      title: '佣金',
      dataIndex: 'commission_balance',
      width: 104,
      align: 'right',
      render: (_, row) =>
        row.invite_user_id ? (
          <div className="order-page-stack is-end">
            <span className="order-page-money">
              {formatMoney(row.commission_balance)}
            </span>
            <span className="order-page-sub">邀请人 #{row.invite_user_id}</span>
          </div>
        ) : (
          <span className="order-page-empty">—</span>
        ),
    },
    {
      title: '佣金状态',
      dataIndex: 'commission_status',
      width: 136,
      // 紧跟在右对齐的金额列后面，多留一点间距，免得「¥12.00」和标签挤在一起
      onHeaderCell: gapAfterNumber,
      onCell: gapAfterNumber,
      render: (_, row) => renderCommissionStatus(row),
    },
    {
      // 标题要短：列设置弹层里超过 4 个字就会被截成「下单 / 支...」
      title: '下单 / 支付',
      dataIndex: 'created_at',
      width: 164,
      render: (_, row) => (
        <div className="order-page-stack tabular-nums">
          <span>{formatTime(row.created_at)}</span>
          <span className="order-page-sub">
            {row.paid_at ? `支付 ${formatTime(row.paid_at)}` : '未支付'}
          </span>
        </div>
      ),
    },
    {
      title: '操作',
      // 固定 key：withPinned 按它改固定状态
      key: 'option',
      valueType: 'option',
      width: 204,
      fixed: pinned ? 'right' : undefined,
      render: (_, row) => (
        <RowActions
          inline={2}
          actions={[
            {
              key: 'detail',
              label: '详情',
              icon: <EyeOutlined />,
              onClick: () => {
                setDetailPlanName(row.plan_name)
                setDetailId(row.id)
              },
            },
            // paid / cancel 后端都只接受 status=0，其他状态不显示按钮而不是点了报错
            row.status === 0 && {
              key: 'paid',
              label: '标记支付',
              icon: <CheckCircleOutlined />,
              onClick: () => confirmPaid(row),
            },
            row.status === 0 && {
              key: 'cancel',
              label: '取消订单',
              icon: <CloseCircleOutlined />,
              danger: true,
              iconOnly: true,
              onClick: () => confirmCancel(row),
            },
          ]}
        />
      ),
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
        columnsState={{
          value: columnsState,
          onChange: setColumnsState,
          // 列设置里的「重置」回到当前断点的默认值
          defaultValue: withPinned({}, pinned),
        }}
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
        tableLayout="fixed"
        // 各列 width 之和。1440 宽时右侧固定操作列左边正好露到「佣金状态」为止，
        // 后一列只露出几像素内边距，不会冒出半个字
        scroll={{ x: 1272 }}
        headerTitle={
          <Space size={8} wrap>
            <span>订单列表</span>
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
        planName={detailPlanName}
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
