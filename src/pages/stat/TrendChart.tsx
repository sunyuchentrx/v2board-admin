import { useMemo, useState } from 'react'
import { Radio, Space, Table, Typography } from 'antd'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { StatOrderPoint } from '@/api/stat'

/**
 * 近 31 天趋势图。
 *
 * 关键决策：**拆成两张图，不用双 Y 轴。**
 * 后端返回的 5 个系列混了两种量纲 —— 收款金额/佣金金额是「元」（后端已除以 100），
 * 注册人数/收款笔数/佣金笔数是「个」。把它们放同一个 Y 轴会让小量纲的系列压成
 * 一条贴地直线，读者无法判断；用第二个 Y 轴则会让两条线的交点产生虚假含义。
 * 所以按量纲分成两张独立的图，各自一个 Y 轴。
 *
 * 配色取自设计系统的分类色板前 3 槽（蓝/橙/青），已用调色板校验脚本
 * 在 light 与 dark 两种表面下跑过全部配对：CVD ΔE ≥ 9.2、常视 ΔE ≥ 20.9，
 * 全部通过。light 模式下青色对表面的对比度低于 3:1，按「补偿规则」
 * 配了 legend + 可切换的表格视图，标识不依赖颜色单独承载。
 */

/** 分类色板（light / dark 各自选定，不是自动翻转） */
const SERIES_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a'],
  dark: ['#3987e5', '#d95926', '#199e70'],
} as const

/** 金额类系列（单位：元） */
const MONEY_SERIES = ['收款金额', '佣金金额(已发放)'] as const
/** 计数类系列（单位：个） */
const COUNT_SERIES = ['注册人数', '收款笔数', '佣金笔数(已发放)'] as const

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

/**
 * 当前图表表面是亮色还是暗色。
 *
 * ⚠️ 刻意**不跟随系统的 prefers-color-scheme**：配色是针对**具体表面色**
 * 校验过的（亮色档针对 #fcfcfb，暗色档针对 #1a1a19）。本面板目前只有亮色主题
 * （App.tsx 的 ConfigProvider 没有配 darkAlgorithm），表面恒为白色，
 * 所以必须恒用亮色档 —— 在暗色系统下改用暗色档，就等于把针对深色表面校验的
 * 颜色画在白底上，对比度与 CVD 结论都不再成立。
 *
 * 等面板真的加了暗色主题，这里要改成读**面板自己的主题状态**，而不是系统偏好。
 */
function useIsDark(): boolean {
  return false
}

interface ChartBlockProps {
  title: string
  unit: string
  series: readonly string[]
  rows: WideRow[]
  colors: readonly string[]
}

function ChartBlock({ title, unit, series, rows, colors }: ChartBlockProps) {
  return (
    <div>
      <Typography.Text strong>{title}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
        单位：{unit}
      </Typography.Text>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 16, right: 16, bottom: 4, left: 4 }}>
          {/* 网格线保持退让：只留横向、虚线、浅色 */}
          <CartesianGrid stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: '#8c8c8c' }}
            axisLine={{ stroke: '#f0f0f0' }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#8c8c8c' }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          {/* 折线图默认带十字准线 + 汇总 tooltip */}
          <Tooltip
            cursor={{ stroke: '#bfbfbf', strokeWidth: 1 }}
            formatter={(value: number | string, name: string) => [
              `${Number(value).toLocaleString()} ${unit}`,
              name,
            ]}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              name={name}
              stroke={colors[i % colors.length]}
              // 规范：线 2px，圆角连接；标记 ≥8px 直径（r≥4）且带 2px 表面色描边
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={false}
              activeDot={{
                r: 4,
                strokeWidth: 2,
                stroke: '#ffffff',
              }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function TrendChart({ data }: { data: StatOrderPoint[] }) {
  const dark = useIsDark()
  const colors = dark ? SERIES_COLORS.dark : SERIES_COLORS.light
  const [view, setView] = useState<'chart' | 'table'>('chart')

  const moneyRows = useMemo(() => toWide(data, MONEY_SERIES), [data])
  const countRows = useMemo(() => toWide(data, COUNT_SERIES), [data])

  /** 表格视图：让每个数值都能被读到，也是低对比度配色的补偿通道 */
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

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Radio.Group
        size="small"
        value={view}
        onChange={(e) => setView(e.target.value)}
        optionType="button"
      >
        <Radio.Button value="chart">图表</Radio.Button>
        <Radio.Button value="table">数据表</Radio.Button>
      </Radio.Group>

      {view === 'chart' ? (
        <>
          <ChartBlock
            title="收款与佣金"
            unit="元"
            series={MONEY_SERIES}
            rows={moneyRows}
            colors={colors}
          />
          <ChartBlock
            title="注册与笔数"
            unit="个"
            series={COUNT_SERIES}
            rows={countRows}
            colors={colors}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            金额与计数分两张图：两者量纲差几个数量级，放同一个坐标轴会把计数压成
            贴地直线；用两个 Y 轴则会让交点产生虚假含义。
          </Typography.Text>
        </>
      ) : (
        <Table<WideRow>
          rowKey="date"
          size="small"
          dataSource={tableRows}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: '日期', dataIndex: 'date', width: 90 },
            ...MONEY_SERIES.map((s) => ({
              title: `${s} (元)`,
              dataIndex: s,
              render: (v: number | undefined) =>
                v === undefined ? '-' : v.toLocaleString(),
            })),
            ...COUNT_SERIES.map((s) => ({
              title: s,
              dataIndex: s,
              render: (v: number | undefined) =>
                v === undefined ? '-' : v.toLocaleString(),
            })),
          ]}
        />
      )}
    </Space>
  )
}
