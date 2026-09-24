import { useId, useMemo, useState } from 'react'
import { Table, Typography, theme } from 'antd'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import type { StatOrderPoint } from '@/api/stat'
import { useColorMode } from '@/theme'

/**
 * 近 31 天趋势图。
 *
 * 关键决策：**拆成两张图，不用双 Y 轴。**
 * 后端返回的 5 个系列混了两种量纲 —— 收款金额/佣金金额是「元」（后端已除以 100），
 * 注册人数/收款笔数/佣金笔数是「个」。把它们放同一个 Y 轴会让小量纲的系列压成
 * 一条贴地直线，读者无法判断；用第二个 Y 轴则会让两条线的交点产生虚假含义。
 * 所以按量纲分成两张独立的图，各自一个 Y 轴（卡片右上角的分段开关切换）。
 *
 * 配色：设计系统图表色板的前 3 个色相（靛/青/琥珀），light 与 dark 各选一档，
 * 用调色板校验脚本在对应表面（#ffffff / #15181f）上跑过全部配对：
 *   light：CVD ΔE ≥ 16.4、常视 ΔE ≥ 21.4、对表面对比度全部 ≥ 3:1；
 *   dark ：CVD ΔE ≥ 16.8、常视 ΔE ≥ 20.8、明度带与对比度全部通过。
 * 另外保留 legend + 数据表视图，系列标识不依赖颜色单独承载。
 */

/** 分类色板（light / dark 各自选定，不是自动翻转） */
const SERIES_COLORS = {
  light: ['#4f46e5', '#0891b2', '#d97706'],
  dark: ['#6366f1', '#0ea5b7', '#d97706'],
} as const

/**
 * 颜色跟着「实体」走，而不是跟着在图里的序号走：
 * 收款（金额/笔数）永远是靛色、佣金永远是琥珀、注册是青色，
 * 两张图之间切换时同一个颜色始终代表同一件事。
 */
const SERIES_SLOT: Record<string, number> = {
  收款金额: 0,
  收款笔数: 0,
  注册人数: 1,
  '佣金金额(已发放)': 2,
  '佣金笔数(已发放)': 2,
}

/** 金额类系列（单位：元） */
const MONEY_SERIES = ['收款金额', '佣金金额(已发放)'] as const
/** 计数类系列（单位：个） */
const COUNT_SERIES = ['注册人数', '收款笔数', '佣金笔数(已发放)'] as const

export type TrendView = 'money' | 'count' | 'table'

/** 卡片右上角分段开关的选项（Dashboard 用） */
export const TREND_VIEW_OPTIONS: { label: string; value: TrendView }[] = [
  { label: '收款与佣金', value: 'money' },
  { label: '注册与笔数', value: 'count' },
  { label: '数据表', value: 'table' },
]

type WideRow = { date: string } & Record<string, number | string>

/** 把后端的长表（type/date/value）转成图表要的宽表 */
function toWide(data: StatOrderPoint[], series: readonly string[]): WideRow[] {
  const byDate = new Map<string, WideRow>()
  for (const point of data) {
    if (!series.includes(point.type)) continue
    let row = byDate.get(point.date)
    if (!row) {
      row = { date: point.date }
      byDate.set(point.date, row)
    }
    row[point.type] = point.value
  }
  return [...byDate.values()]
}

const yuanFmt = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const countFmt = new Intl.NumberFormat('zh-CN')
const compactFmt = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

type Kind = 'money' | 'count'

function formatValue(v: number, kind: Kind): string {
  return kind === 'money' ? `¥${yuanFmt.format(v)}` : countFmt.format(v)
}

/** Y 轴刻度：上万以后用「1.2万」，避免刻度文字把绘图区挤窄 */
function formatTick(v: number): string {
  return Math.abs(v) >= 10000 ? compactFmt.format(v) : countFmt.format(v)
}

/**
 * 当前图表表面是亮色还是暗色。
 *
 * ⚠️ 刻意**不跟随系统的 prefers-color-scheme**：配色是针对**具体表面色**
 * 校验过的（亮色档针对 #ffffff，暗色档针对 #15181f）。读的是**面板自己的主题状态**
 * （src/theme 的 useColorMode，用户可以手动切换并记住），它和系统偏好可能不一致 ——
 * 跟随系统就会出现把暗色档颜色画在白底上的情况，对比度与 CVD 结论都不再成立。
 */
function useIsDark(): boolean {
  return useColorMode().mode === 'dark'
}

/** 系统开了「减少动态效果」时不播放入场动画（recharts 2 自己不看这个设置） */
function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  return reduced
}

/** Tooltip：值在前、系列名在后；短线条作为系列标识（不用色块） */
function TrendTooltip({
  active,
  payload,
  label,
  kind,
  hidden,
}: TooltipProps<number, string> & { kind: Kind; hidden?: Set<string> }) {
  const { token } = theme.useToken()
  // 被图例隐藏的系列 recharts 仍会放进 payload，这里滤掉
  const rows = payload?.filter((p) => !hidden?.has(String(p.dataKey))) ?? []
  if (!active || !rows.length) return null
  return (
    <div
      className="dash-tip"
      style={{
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorder}`,
        boxShadow: token.boxShadowSecondary,
        borderRadius: token.borderRadius,
      }}
    >
      <div className="dash-tip-date">{label}</div>
      {rows.map((p) => (
        <div className="dash-tip-row" key={String(p.dataKey)}>
          <span className="dash-tip-key" style={{ background: p.color }} />
          <span className="dash-tip-name">{p.name}</span>
          <span className="dash-tip-value tabular-nums">
            {formatValue(Number(p.value), kind)}
          </span>
        </div>
      ))}
    </div>
  )
}

interface ChartBlockProps {
  kind: Kind
  series: readonly string[]
  rows: WideRow[]
  colors: readonly string[]
  /** 被图例隐藏的系列（状态放在 TrendChart，切到「数据表」再切回来不丢） */
  hidden: Set<string>
  onHiddenChange: (next: Set<string>) => void
}

function ChartBlock({ kind, series, rows, colors, hidden, onHiddenChange }: ChartBlockProps) {
  const { token } = theme.useToken()
  // SVG 渐变的 id 要全局唯一；useId 带冒号，放进 url(#...) 里不安全
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const reducedMotion = usePrefersReducedMotion()

  /** 31 天合计，放在 legend 里：legend 同时承担「系列标识」和「总量」 */
  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const name of series) {
      t[name] = rows.reduce((sum, r) => sum + (Number(r[name]) || 0), 0)
    }
    return t
  }, [rows, series])

  function toggle(name: string) {
    const next = new Set(hidden)
    if (next.has(name)) next.delete(name)
    // 至少保留一条，否则图是空的，读者会以为没数据
    else if (series.length - next.size > 1) next.add(name)
    onHiddenChange(next)
  }

  const colorOf = (name: string) => colors[SERIES_SLOT[name] ?? 0] ?? colors[0]!

  return (
    <div className="dash-trend">
      <div className="dash-trend-legend">
        {series.map((name) => {
          const off = hidden.has(name)
          return (
            <button
              key={name}
              type="button"
              className={`dash-trend-key${off ? ' is-off' : ''}`}
              aria-pressed={!off}
              title={off ? '点击显示该系列' : '点击隐藏该系列'}
              onClick={() => toggle(name)}
            >
              <span className="dash-trend-key-name">
                <span className="dash-trend-key-line" style={{ background: colorOf(name) }} />
                {name}
              </span>
              <span className="dash-trend-key-value tabular-nums">
                {formatValue(totals[name] ?? 0, kind)}
              </span>
            </button>
          )
        })}
        <span className="dash-trend-legend-note">
          近 31 天合计 · 单位：{kind === 'money' ? '元' : '个'}
        </span>
      </div>

      <div className="dash-trend-plot">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
            <defs>
              {series.map((name) => (
                <linearGradient key={name} id={`${gid}-${SERIES_SLOT[name] ?? 0}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorOf(name)} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={colorOf(name)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {/* 网格线保持退让：只留横向、虚线、最浅的分隔色 */}
            <CartesianGrid
              stroke={token.colorBorderSecondary}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: token.colorTextTertiary }}
              axisLine={{ stroke: token.colorBorder }}
              tickLine={false}
              tickMargin={8}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 12, fill: token.colorTextTertiary }}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={formatTick}
            />
            {/* 面积/折线图默认带十字准线 + 汇总 tooltip */}
            <Tooltip
              cursor={{ stroke: token.colorBorder, strokeWidth: 1 }}
              content={<TrendTooltip kind={kind} hidden={hidden} />}
            />
            {series.map((name) => (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                hide={hidden.has(name)}
                stroke={colorOf(name)}
                fill={`url(#${gid}-${SERIES_SLOT[name] ?? 0})`}
                // 规范：线 2px，圆角连接；标记 ≥8px 直径（r≥4）且带 2px 表面色描边
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={false}
                activeDot={{
                  r: 4,
                  strokeWidth: 2,
                  stroke: token.colorBgContainer,
                }}
                isAnimationActive={!reducedMotion}
                animationDuration={500}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function TrendChart({
  data,
  view,
}: {
  data: StatOrderPoint[]
  view: TrendView
}) {
  const dark = useIsDark()
  const colors = dark ? SERIES_COLORS.dark : SERIES_COLORS.light
  // 图例隐藏状态按图分开记，放在这里而不是 ChartBlock 里：切视图时 ChartBlock 会卸载
  const [hidden, setHidden] = useState<Record<Kind, Set<string>>>(() => ({
    money: new Set(),
    count: new Set(),
  }))
  const setHiddenOf = (kind: Kind) => (next: Set<string>) =>
    setHidden((prev) => ({ ...prev, [kind]: next }))

  const moneyRows = useMemo(() => toWide(data, MONEY_SERIES), [data])
  const countRows = useMemo(() => toWide(data, COUNT_SERIES), [data])

  /** 表格视图：让每个数值都能被读到，也是颜色之外的第二条识别通道 */
  const tableRows = useMemo(() => {
    const byDate = new Map<string, WideRow>()
    for (const p of data) {
      let row = byDate.get(p.date)
      if (!row) {
        row = { date: p.date }
        byDate.set(p.date, row)
      }
      row[p.type] = p.value
    }
    return [...byDate.values()].reverse()
  }, [data])

  if (view === 'table') {
    return (
      <div className="dash-trend-table">
        {/* 单位放表格上方一行说明，不写进列名：「佣金金额(已发放) (元)」两对括号在手机上会折成两行 */}
        <Typography.Text type="secondary" className="dash-trend-table-note">
          按日期倒序 · 金额单位：元
        </Typography.Text>
        <Table<WideRow>
          rowKey="date"
          size="small"
          dataSource={tableRows}
          scroll={{ x: 720 }}
          pagination={{ pageSize: 10, showSizeChanger: false, size: 'small' }}
          columns={[
            // 手机上横向滑动时日期列固定在左边，否则滑过去就对不上是哪一天
            { title: '日期', dataIndex: 'date', width: 90, fixed: 'left' as const, className: 'tabular-nums' },
            ...MONEY_SERIES.map((s) => ({
              title: s,
              dataIndex: s,
              align: 'right' as const,
              render: (v: number | undefined) =>
                v === undefined ? (
                  <Typography.Text type="secondary">—</Typography.Text>
                ) : (
                  yuanFmt.format(v)
                ),
            })),
            ...COUNT_SERIES.map((s) => ({
              title: s,
              dataIndex: s,
              align: 'right' as const,
              render: (v: number | undefined) =>
                v === undefined ? (
                  <Typography.Text type="secondary">—</Typography.Text>
                ) : (
                  countFmt.format(v)
                ),
            })),
          ]}
        />
      </div>
    )
  }

  return (
    <div className="dash-trend-wrap">
      {view === 'money' ? (
        <ChartBlock
          key="money"
          kind="money"
          series={MONEY_SERIES}
          rows={moneyRows}
          colors={colors}
          hidden={hidden.money}
          onHiddenChange={setHiddenOf('money')}
        />
      ) : (
        <ChartBlock
          key="count"
          kind="count"
          series={COUNT_SERIES}
          rows={countRows}
          colors={colors}
          hidden={hidden.count}
          onHiddenChange={setHiddenOf('count')}
        />
      )}
      {/* 中文断行处不能直接换行：JSX 会把换行折成一个空格 */}
      <Typography.Text type="secondary" className="dash-trend-foot">
        {'金额与计数分两张图：两者量纲差几个数量级，放同一个坐标轴会把计数压成贴地直线；' +
          '用两个 Y 轴则会让交点产生虚假含义。点击上方图例可隐藏/显示单个系列。'}
      </Typography.Text>
    </div>
  )
}
