import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Grid,
  Row,
  Segmented,
  Skeleton,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  CustomerServiceOutlined,
  ExclamationCircleOutlined,
  PayCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  TeamOutlined,
  UserAddOutlined,
  WalletOutlined,
  WifiOutlined,
  GiftOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
  fetchServerLastRank,
  fetchServerTodayRank,
  fetchStatOverview,
  fetchStatTrend,
  fetchUserLastRank,
  fetchUserTodayRank,
  type ServerRankItem,
  type StatOrderPoint,
  type UserRankItem,
} from '@/api/stat'
import { centsToYuan } from '@/lib/format'
import TrendChart, { TREND_VIEW_OPTIONS, type TrendView } from './TrendChart'
import './Dashboard.css'

const yuanFmt = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const countFmt = new Intl.NumberFormat('zh-CN')

/** 分 → 「¥1,234.56」（带千分位） */
function yuan(cents: number | null | undefined): string {
  return `¥${yuanFmt.format(centsToYuan(cents))}`
}

/**
 * 环比：本月 vs 上月。
 * 收入类涨=绿、跌=红；成本类（佣金支出）涨跌没有好坏之分，用 neutral 只保留箭头、不染色，
 * 否则「佣金支出 ↑ 300%」会被读成喜报。
 */
function MoMTag({
  current,
  previous,
  neutral,
}: {
  current: number
  previous: number
  neutral?: boolean
}) {
  if (!previous) return null
  const delta = ((current - previous) / previous) * 100
  const up = delta >= 0
  // 只影响显示：上月基数很小时百分比会变成几百万，截成 >999%
  const pct = Math.abs(delta)
  const tone = neutral ? 'is-neutral' : up ? 'is-up' : 'is-down'
  return (
    <span className={`dash-delta ${tone}`} title="较上月">
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {pct >= 1000 ? '>999%' : `${pct.toFixed(1)}%`}
    </span>
  )
}

type Tone = 'primary' | 'warning' | 'error'

/** 统计卡片：标题 + 图标方块 / 大号数字 / 一行次要信息 */
function KpiCard({
  label,
  icon,
  value,
  money,
  tone = 'primary',
  valueTone,
  footer,
  loading,
  error,
}: {
  label: string
  icon: ReactNode
  /** 金额（分）或计数 */
  value: number
  /** value 是金额（分）时为 true */
  money?: boolean
  tone?: Tone
  /** 数字本身要不要染色（待办类 > 0 时） */
  valueTone?: 'warning' | 'error'
  footer: ReactNode
  /** 首次加载还没有数据：数字位放骨架、底部放「—」，不要先显示 0 / 「暂无待办」 */
  loading?: boolean
  /** 请求失败且手上没有数据：数字位放「—」、底部标红「加载失败」，同样不能回落成 0 */
  error?: boolean
}) {
  let main: ReactNode
  if (loading) {
    main = <Skeleton.Input active size="small" className="dash-kpi-skeleton" />
  } else if (error) {
    main = <span className="dash-kpi-na">—</span>
  } else if (money) {
    const [int, dec] = yuanFmt.format(centsToYuan(value)).split('.')
    main = (
      <>
        <span className="dash-kpi-unit">¥</span>
        {int}
        <span className="dash-kpi-dec">.{dec}</span>
      </>
    )
  } else {
    main = countFmt.format(value)
  }
  return (
    <Card className="dash-kpi">
      <div className="dash-kpi-head">
        <span className="dash-kpi-label">{label}</span>
        <span className={`dash-kpi-icon is-${tone}`}>{icon}</span>
      </div>
      <div
        className={`dash-kpi-value tabular-nums${valueTone && !error ? ` is-${valueTone}` : ''}`}
      >
        {main}
      </div>
      <div className="dash-kpi-foot">
        {loading ? (
          <span className="muted">—</span>
        ) : error ? (
          <span className="dash-kpi-failed">
            <ExclamationCircleOutlined />
            加载失败
          </span>
        ) : (
          footer
        )}
      </div>
    </Card>
  )
}

/**
 * 卡片底部的跳转链接。
 * tip：目标列表不会自动带筛选条件（列表页不读 URL 参数）时，悬停告诉管理员到那边要怎么筛。
 */
function GoLink({ to, tip, children }: { to: string; tip?: string; children: ReactNode }) {
  const link = (
    <Link to={to} className="dash-kpi-link">
      {children}
      <ArrowRightOutlined />
    </Link>
  )
  return tip ? <Tooltip title={tip}>{link}</Tooltip> : link
}

/** 排行名次徽标：前 3 名用主色强调 */
function RankBadge({ n }: { n: number }) {
  return <span className={`dash-rank${n <= 3 ? ` is-top is-top-${n}` : ''}`}>{n}</span>
}

/** 流量列：数值 + 相对第一名的长度条（条只表示量级，占比另起一列） */
function TrafficCell({ value, max, bar }: { value: number; max: number; bar: boolean }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className={`dash-traffic${bar ? ' has-bar' : ''}`}>
      {bar && (
        <div className="dash-traffic-bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      <span className="dash-traffic-value tabular-nums">
        {yuanFmt.format(value)}
        <span className="dash-traffic-unit">GB</span>
      </span>
    </div>
  )
}

/** 元素的内容宽度（ResizeObserver）；首帧还没量到时为 0 */
function useWidth<E extends HTMLElement>() {
  const ref = useRef<E>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** 排行表各固定列的宽度（rankXs：手机上的名次列） */
const RANK_COL = { rank: 48, rankXs: 40, share: 72, trafficBar: 180, proto: 112 } as const
/** 名称列（节点名/邮箱）至少留这么宽，才轮得到流量条和协议列 */
const RANK_NAME_MIN = 240

/**
 * 不画长度条时的流量列宽：按本榜最大值的字符数定宽，而不是固定 116px ——
 * 「154.73 GB」只要 ~70px，固定宽度在手机上白白吃掉名称列 ~30px，邮箱几乎全被截断。
 * 数字是等宽数字，1ch ≈ 一位数字（千分位/小数点更窄，算宽了正好当余量）；
 * 40px = 单位「GB」（12px 小字）+ 单元格左右内边距。
 */
function trafficColWidth(max: number): string {
  return `calc(${yuanFmt.format(max).length}ch + 40px)`
}

interface RankDensity {
  /** 流量列画长度条 */
  bar: boolean
  /** 协议单独一列 */
  protoCol: boolean
  /**
   * 协议列放不下时，协议以小字跟在名称后面。
   * 和名称在同一个省略单元格里、排在名称后面，所以空间不够时先被截掉的是协议，不会挤短名称；
   * 完整的「名称 · 协议」在单元格 title 里。
   */
  protoInline: boolean
}

/**
 * 排行表的列密度：按卡片的实际宽度决定，而不是按屏幕断点猜。
 * 名称是这张表最关键的信息 —— xl 下两张卡并排时每张只有 ~470–550px，
 * 先保证名称列 ≥ 240px，剩下的宽度依次给流量条、协议列。
 */
function rankDensity(width: number, wide: boolean, hasProto: boolean): RankDensity {
  const rankCol = wide ? RANK_COL.rank : RANK_COL.rankXs
  const base = rankCol + (wide ? RANK_COL.share : 0) + RANK_COL.trafficBar + RANK_NAME_MIN
  const bar = width >= base
  const protoCol = hasProto && width >= base + RANK_COL.proto
  return { bar, protoCol, protoInline: hasProto && !protoCol }
}

type Period = 'today' | 'yesterday'

/** 一个排行接口的状态：还没拿到数据 / 失败且没有数据 / 有数据（可能为空） */
type LoadState = 'pending' | 'error' | 'ok'

function loadStateOf(q: { isPending: boolean; isError: boolean }): LoadState {
  return q.isPending ? 'pending' : q.isError ? 'error' : 'ok'
}

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: '今日', value: 'today' },
  { label: '昨日', value: 'yesterday' },
]

/**
 * 排行卡片：右上角切今日/昨日，表格紧凑、带名次与流量条。
 *
 * total 的单位都是 GB：节点排行是后端已经换算成 GB；
 * 用户排行是已按节点倍率加权后换算成 GB。
 */
function RankCard<T extends { total: number }>({
  title,
  icon,
  today,
  yesterday,
  rowKey,
  nameColumns,
  hasProto = false,
  status,
  onRetry,
  retrying,
}: {
  title: string
  icon: ReactNode
  today: T[]
  yesterday: T[]
  rowKey: (row: T) => string
  /** 名次与流量之间的业务列（节点名/协议、用户邮箱），按列密度生成 */
  nameColumns: (density: RankDensity) => ColumnsType<T>
  /** 这张表有协议信息要放（节点排行） */
  hasProto?: boolean
  /** 两天各自的接口状态：没数据时据此决定空状态显示骨架 / 失败 / 暂无记录 */
  status: Record<Period, LoadState>
  /** 失败时空状态里的「重试」 */
  onRetry: () => void
  retrying?: boolean
}) {
  const [period, setPeriod] = useState<Period>('today')
  // 占比列只在 sm 以上显示（见下方 responsive），算密度时要一起扣掉
  const wide = Grid.useBreakpoint().sm ?? true
  const [bodyRef, bodyWidth] = useWidth<HTMLDivElement>()
  // 名称列太窄时（并排 / 手机），流量列只留数字、不画长度条
  const density = rankDensity(bodyWidth, wide, hasProto)
  const { bar } = density
  const state = status[period]
  const rows = period === 'today' ? today : yesterday
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0)
  const sum = rows.reduce((s, r) => s + r.total, 0)
  const dayText = period === 'today' ? '今日' : '昨日'

  let emptyText: ReactNode
  if (state === 'pending') {
    // 还在请求时不能显示「暂无流量记录」，否则网络慢会被误读成上报/队列坏了
    emptyText = (
      <Skeleton active title={false} paragraph={{ rows: 8 }} className="dash-rank-skeleton" />
    )
  } else if (state === 'error') {
    // 同理：请求失败也不能显示「暂无流量记录」
    // 不用默认的「空盒子」插图：它表示「没数据」（SVG 标题也是「暂无数据」），和「失败」矛盾
    emptyText = (
      <Empty
        image={<ExclamationCircleOutlined />}
        className="dash-rank-failed"
        description={`${dayText}排行加载失败`}
      >
        <Button size="small" icon={<ReloadOutlined />} loading={retrying} onClick={onRetry}>
          重试
        </Button>
      </Empty>
    )
  } else {
    emptyText = (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${dayText}暂无流量记录`} />
    )
  }

  const columns: ColumnsType<T> = [
    {
      title: '#',
      key: 'rank',
      width: wide ? RANK_COL.rank : RANK_COL.rankXs,
      align: 'center',
      render: (_: unknown, __: T, index: number) => <RankBadge n={index + 1} />,
    },
    ...nameColumns(density),
    {
      title: '流量',
      dataIndex: 'total',
      key: 'total',
      width: bar ? RANK_COL.trafficBar : trafficColWidth(max),
      align: 'right',
      render: (v: number) => <TrafficCell value={v} max={max} bar={bar} />,
    },
    {
      title: (
        <Tooltip title="占本榜前 15 名合计流量的比例，不是占全站">
          <span className="dash-th-hint">
            占比
            <QuestionCircleOutlined />
          </span>
        </Tooltip>
      ),
      key: 'share',
      width: RANK_COL.share,
      align: 'right',
      responsive: ['sm'],
      render: (_: unknown, row: T) => (
        <span className="dash-share tabular-nums">
          {sum > 0 ? `${((row.total / sum) * 100).toFixed(1)}%` : '—'}
        </span>
      ),
    },
  ]

  return (
    <Card
      className="dash-rank-card"
      title={
        <span className="dash-card-title">
          <span className="dash-card-title-icon">{icon}</span>
          {title}
          <span className="dash-card-title-sub">前 15 名</span>
        </span>
      }
      extra={
        <Segmented<Period>
          aria-label={`${title}日期`}
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
        />
      }
    >
      <div ref={bodyRef}>
        <Table<T>
          rowKey={rowKey}
          size="small"
          tableLayout="fixed"
          pagination={false}
          dataSource={rows}
          columns={columns}
          locale={{ emptyText }}
        />
      </div>
    </Card>
  )
}

export default function Dashboard() {
  const qc = useQueryClient()
  const [trendView, setTrendView] = useState<TrendView>('money')
  const screens = Grid.useBreakpoint()

  const results = useQueries({
    queries: [
      { queryKey: ['stat-overview'], queryFn: fetchStatOverview },
      { queryKey: ['stat-trend'], queryFn: fetchStatTrend },
      { queryKey: ['server-today-rank'], queryFn: fetchServerTodayRank },
      { queryKey: ['server-last-rank'], queryFn: fetchServerLastRank },
      { queryKey: ['user-today-rank'], queryFn: fetchUserTodayRank },
      { queryKey: ['user-last-rank'], queryFn: fetchUserLastRank },
    ],
  })

  const [overview, trend, serverToday, serverLast, userToday, userLast] = results
  const loading = results.some((r) => r.isFetching)
  const updatedAt = Math.max(...results.map((r) => r.dataUpdatedAt))

  const o = overview.data
  const trendData = (trend.data ?? []) as StatOrderPoint[]

  function reloadAll() {
    for (const key of [
      'stat-overview',
      'stat-trend',
      'server-today-rank',
      'server-last-rank',
      'user-today-rank',
      'user-last-rank',
    ]) {
      qc.invalidateQueries({ queryKey: [key] })
    }
  }

  const ticketPending = o?.ticket_pending_total ?? 0
  const commissionPending = o?.commission_pending_total ?? 0
  const kpiLoading = overview.isPending
  // 失败且手上没有旧数据：不能让 ?? 0 把失败显示成「¥0.00 / 暂无待办」
  const kpiError = overview.isError && !o

  /**
   * 工具行状态。只在「全部失败」时整句报错；部分失败时照常显示更新时间，后面标出失败项数，
   * 具体是哪一块由对应卡片自己的失败状态说明。
   */
  const failedCount = results.filter((r) => r.isError).length
  let updatedText: ReactNode
  if (updatedAt > 0) {
    updatedText = (
      <>
        <ClockCircleOutlined />
        {`数据更新于 ${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`}
        {failedCount > 0 && (
          <Typography.Text type="danger" className="dash-updated-failed">
            （{failedCount} 项加载失败）
          </Typography.Text>
        )}
      </>
    )
  } else if (failedCount > 0 && !loading) {
    updatedText = (
      <Typography.Text type="danger" className="dash-updated-failed">
        <ExclamationCircleOutlined />
        数据加载失败，点刷新重试
      </Typography.Text>
    )
  } else {
    updatedText = (
      <>
        <ClockCircleOutlined />
        正在加载数据…
      </>
    )
  }

  const serverColumns = ({ protoCol, protoInline }: RankDensity): ColumnsType<ServerRankItem> => [
    {
      title: '节点',
      dataIndex: 'server_name',
      ellipsis: true,
      // render 返回的不是纯字符串，antd 的 ellipsis 不会自动加 title，截断后悬停看不到全称，这里补上
      onCell: (row: ServerRankItem) => ({
        title: `${row.server_name ?? `#${row.server_id}`} · ${row.server_type}`,
      }),
      render: (v: string | undefined, row: ServerRankItem) => (
        <>
          {v ?? <Typography.Text type="secondary">#{row.server_id}</Typography.Text>}
          {/* 协议列收起时跟在名称后面；整格一起省略，所以先被截掉的是协议而不是名称 */}
          {protoInline && <span className="dash-proto-inline mono">{row.server_type}</span>}
        </>
      ),
    },
    ...(protoCol
      ? [
          {
            title: '协议',
            dataIndex: 'server_type',
            width: RANK_COL.proto,
            render: (v: string) => (
              <Tag bordered={false} className="dash-proto mono">
                {v}
              </Tag>
            ),
          },
        ]
      : []),
  ]

  const userColumns = (): ColumnsType<UserRankItem> => [
    {
      title: '用户',
      dataIndex: 'email',
      ellipsis: true,
      render: (v: string, row: UserRankItem) =>
        // 后端在用户已删除时返回字符串 "null"
        v && v !== 'null' ? v : (
          <Typography.Text type="secondary">已删除 #{row.user_id}</Typography.Text>
        ),
    },
  ]

  /*
   * 不再用整页 Spin 蒙层：首次加载由各卡片的骨架屏表示（蒙层会把骨架冲淡到看不见），
   * 刷新时由按钮自己转圈，已有数据的卡片原地更新（整页发白、滚到底部时转圈还不在视口里）。
   */
  return (
    <Flex vertical gap={16} className="dash">
      <Flex justify="space-between" align="center" gap={12} wrap className="dash-toolbar">
        <Typography.Text type="secondary" className="dash-updated" aria-live="polite">
          {updatedText}
        </Typography.Text>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={reloadAll}>
          刷新
        </Button>
      </Flex>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6} className="dash-kpi-col">
          <KpiCard
            label="今日收款"
            loading={kpiLoading}
            error={kpiError}
            icon={<WalletOutlined />}
            value={o?.day_income ?? 0}
            money
            footer={<span className="muted">今日下单且已支付</span>}
          />
        </Col>
        <Col xs={24} sm={12} xl={6} className="dash-kpi-col">
          <KpiCard
            label="本月收款"
            loading={kpiLoading}
            error={kpiError}
            icon={<PayCircleOutlined />}
            value={o?.month_income ?? 0}
            money
            footer={
              <>
                <MoMTag
                  current={o?.month_income ?? 0}
                  previous={o?.last_month_income ?? 0}
                />
                <span className="muted">上月 {yuan(o?.last_month_income)}</span>
              </>
            }
          />
        </Col>
        <Col xs={24} sm={12} xl={6} className="dash-kpi-col">
          <KpiCard
            label="本月佣金支出"
            loading={kpiLoading}
            error={kpiError}
            icon={<GiftOutlined />}
            value={o?.commission_month_payout ?? 0}
            money
            footer={
              <>
                {/* 成本类指标：涨跌不染成「好 / 坏」 */}
                <MoMTag
                  neutral
                  current={o?.commission_month_payout ?? 0}
                  previous={o?.commission_last_month_payout ?? 0}
                />
                <span className="muted">上月 {yuan(o?.commission_last_month_payout)}</span>
              </>
            }
          />
        </Col>
        <Col xs={24} sm={12} xl={6} className="dash-kpi-col">
          <KpiCard
            label="在线用户"
            loading={kpiLoading}
            error={kpiError}
            icon={<WifiOutlined />}
            value={o?.online_user ?? 0}
            footer={<span className="muted">近 10 分钟内有流量上报</span>}
          />
        </Col>

        <Col xs={12} lg={6} className="dash-kpi-col">
          <KpiCard
            label="今日注册"
            loading={kpiLoading}
            error={kpiError}
            icon={<UserAddOutlined />}
            value={o?.day_register_total ?? 0}
            footer={<GoLink to="/user">用户管理</GoLink>}
          />
        </Col>
        <Col xs={12} lg={6} className="dash-kpi-col">
          <KpiCard
            label="本月注册"
            loading={kpiLoading}
            error={kpiError}
            icon={<TeamOutlined />}
            value={o?.month_register_total ?? 0}
            footer={<span className="muted">本月 1 日起累计</span>}
          />
        </Col>
        <Col xs={12} lg={6} className="dash-kpi-col">
          <KpiCard
            label="待处理工单"
            loading={kpiLoading}
            error={kpiError}
            icon={<CustomerServiceOutlined />}
            value={ticketPending}
            tone={ticketPending > 0 ? 'error' : 'primary'}
            valueTone={ticketPending > 0 ? 'error' : undefined}
            footer={
              ticketPending > 0 ? (
                // 工单列表不读 URL 参数，跳过去是全部工单，所以悬停提示要怎么筛
                <GoLink to="/ticket" tip="在工单列表筛选「开启中 · 待回复」">
                  去回复
                </GoLink>
              ) : (
                <span className="muted">暂无待办</span>
              )
            }
          />
        </Col>
        <Col xs={12} lg={6} className="dash-kpi-col">
          <KpiCard
            label="待确认佣金"
            loading={kpiLoading}
            error={kpiError}
            icon={<AuditOutlined />}
            value={commissionPending}
            tone={commissionPending > 0 ? 'warning' : 'primary'}
            valueTone={commissionPending > 0 ? 'warning' : undefined}
            footer={
              commissionPending > 0 ? (
                // 同上：订单列表不读 URL 参数
                <GoLink to="/order" tip="在订单列表按「佣金状态：待确认」筛选">
                  去确认
                </GoLink>
              ) : (
                <span className="muted">暂无待办</span>
              )
            }
          />
        </Col>
      </Row>

      <Card
        className="dash-trend-card"
        title={
          <span className="dash-card-title">
            近 31 天趋势
            <span className="dash-card-title-sub">按日汇总</span>
          </span>
        }
        extra={
          trendData.length > 0 && (
            <Segmented<TrendView>
              aria-label="趋势视图"
              // 手机上开关换到第二行，撑满整行，和下方通栏内容对齐
              block={screens.sm === false}
              options={TREND_VIEW_OPTIONS}
              value={trendView}
              onChange={setTrendView}
            />
          )
        }
      >
        {trend.isPending ? (
          // 首次加载时不能先亮出「暂无趋势数据 / 去查 crontab」，会误导排障
          <Skeleton active paragraph={{ rows: 8 }} className="dash-trend-skeleton" />
        ) : trend.isError && trendData.length === 0 ? (
          // 同理：接口失败不是「没数据」，不能走下面 crontab 的排障提示
          <Alert
            type="error"
            showIcon
            message="趋势数据加载失败"
            description={
              trend.error?.message
                ? `接口返回：${trend.error.message}`
                : '接口请求出错，和计划任务无关。'
            }
            action={
              <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={reloadAll}>
                重试
              </Button>
            }
          />
        ) : trendData.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message="暂无趋势数据"
            description={
              <>
                趋势数据来自 v2_stat 表，由计划任务
                <Typography.Text code>php artisan v2board:statistics</Typography.Text>
                每日写入。如果一直为空，先确认 crontab 里的
                <Typography.Text code>schedule:run</Typography.Text>
                在正常执行。
              </>
            }
          />
        ) : (
          <TrendChart data={trendData} view={trendView} />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <RankCard<ServerRankItem>
            title="节点流量排行"
            icon={<CloudServerOutlined />}
            today={serverToday.data ?? []}
            yesterday={serverLast.data ?? []}
            status={{ today: loadStateOf(serverToday), yesterday: loadStateOf(serverLast) }}
            onRetry={reloadAll}
            retrying={loading}
            rowKey={(r) => `${r.server_type}-${r.server_id}`}
            nameColumns={serverColumns}
            hasProto
          />
        </Col>
        <Col xs={24} xl={12}>
          <RankCard<UserRankItem>
            title="用户流量排行"
            icon={<UserOutlined />}
            today={userToday.data ?? []}
            yesterday={userLast.data ?? []}
            status={{ today: loadStateOf(userToday), yesterday: loadStateOf(userLast) }}
            onRetry={reloadAll}
            retrying={loading}
            rowKey={(r) => String(r.user_id)}
            nameColumns={userColumns}
          />
        </Col>
      </Row>

      {/* 中文断行处不能直接换行：JSX 会把换行折成一个空格 */}
      <Typography.Text type="secondary" className="dash-note">
        {'说明：流量排行取 v2_stat_server / v2_stat_user 表，依赖节点上报与 traffic_fetch 队列；' +
          '「在线用户」按 v2_user.t 最近 10 分钟判定。' +
          '节点排行只统计父节点（parent_id 为空）。'}
      </Typography.Text>
    </Flex>
  )
}
