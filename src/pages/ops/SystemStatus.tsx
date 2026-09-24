import { useRef, type ReactNode } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import {
  Alert,
  Button,
  Card,
  Col,
  Grid,
  Row,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ClusterOutlined,
  DashboardOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  ScheduleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import {
  fetchQueueStats,
  fetchQueueWorkload,
  fetchSystemStatus,
  type QueueWorkloadItem,
  type SystemLogItem,
} from '@/api/ops'
import { formatTime } from '@/lib/format'
import './SystemStatus.css'

/** 日志级别 → Tag 语义色（与全站 success/processing/warning/error/default 一致） */
const LEVEL_COLOR: Record<string, string> = {
  emergency: 'error',
  alert: 'error',
  critical: 'error',
  error: 'error',
  warning: 'warning',
  notice: 'processing',
  info: 'processing',
  debug: 'default',
}

const fmtInt = (n: number) => n.toLocaleString('en-US')

/** Horizon 的 periods 单位是分钟（horizon.trim.*），换成「近 N 小时 / 天」 */
function periodText(minutes: number | undefined): string | null {
  if (!minutes) return null
  if (minutes < 60) return `近 ${minutes} 分钟`
  if (minutes < 1440) return `近 ${Math.round(minutes / 60)} 小时`
  return `近 ${Math.round(minutes / 1440)} 天`
}

/** unix 秒 → 「23 秒前」这种相对时间（计划任务判定口径是 120 秒内，秒级更直观） */
function ago(seconds: number | null | undefined): string | null {
  if (!seconds) return null
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds)
  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

/**
 * 日志附加数据：是合法 JSON 就重新缩进展示，否则原样（始终作为纯文本渲染）。
 *
 * 只改字符串之外的空白，不能走 JSON.parse → JSON.stringify 往返：那样会把超过 2^53 的整数
 * （支付回调的 trade_no、数字 id）四舍五入、合并重复键、解码 \uXXXX 转义、把 1.0 变成 1，
 * 排错时看到的就不是原始数据了。JSON.parse 在这里只用来确认它是合法 JSON。
 */
function prettyData(data: string | null): string | null {
  if (!data) return null
  const s = data.trim()
  if (!s.startsWith('{') && !s.startsWith('[')) return data
  try {
    JSON.parse(s)
  } catch {
    // 不是合法 JSON，按原文显示
    return data
  }
  return reindentJson(s)
}

/** JSON 允许的空白只有这四个；字符串外的其它字符（标点、数字、true/false/null）原样保留 */
const JSON_WS = ' \t\n\r'

/** 逐字符重排缩进：字符串内容（含转义）与数字字面量一个字符都不动 */
function reindentJson(s: string): string {
  let out = ''
  let depth = 0
  let inStr = false
  let escaped = false
  const newline = () => '\n' + '  '.repeat(depth)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (inStr) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inStr = false
      continue
    }
    if (JSON_WS.includes(c)) continue
    if (c === '"') {
      inStr = true
      out += c
    } else if (c === '{' || c === '[') {
      // 空对象 / 空数组保持 {} / [] 一行
      const close = c === '{' ? '}' : ']'
      let j = i + 1
      while (j < s.length && JSON_WS.includes(s[j]!)) j++
      if (s[j] === close) {
        out += c + close
        i = j
      } else {
        depth++
        out += c + newline()
      }
    } else if (c === '}' || c === ']') {
      depth--
      out += newline() + c
    } else if (c === ',') {
      out += ',' + newline()
    } else if (c === ':') {
      out += ': '
    } else {
      out += c
    }
  }
  return out
}

function HealthTile({
  icon,
  title,
  loading,
  ok,
  okText,
  badText,
  detail,
}: {
  icon: ReactNode
  title: string
  loading: boolean
  ok: boolean
  okText: string
  badText: string
  detail: ReactNode
}) {
  const tone = loading ? 'is-pending' : ok ? 'is-ok' : 'is-bad'
  return (
    <div className={`sys-page-health ${tone}`}>
      <span className="sys-page-health-icon">{icon}</span>
      <div className="sys-page-health-main">
        <div className="sys-page-health-head">
          <span className="sys-page-health-title">{title}</span>
          {loading ? (
            <Tag bordered={false} icon={<LoadingOutlined />}>
              检测中
            </Tag>
          ) : (
            <Tag
              bordered={false}
              color={ok ? 'success' : 'error'}
              icon={ok ? <CheckCircleFilled /> : <CloseCircleFilled />}
            >
              {ok ? okText : badText}
            </Tag>
          )}
        </div>
        {/* 检测中不显示「从未执行」这类兜底文案，免得被当成真实结果 */}
        <div className="sys-page-health-detail">{loading ? '—' : detail}</div>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  tone,
  foot,
  footTitle,
  loading,
  unavailable,
}: {
  title: string
  value: number
  icon: ReactNode
  tone?: 'error' | 'warning'
  foot: ReactNode
  /** 说明行会被省略时，悬停看完整内容 */
  footTitle?: string
  /** 首次加载：数字位放骨架，不先显示 0 和兜底说明 */
  loading?: boolean
  /** 请求失败且没有数据：显示「—」，不能回落成 0 */
  unavailable?: boolean
}) {
  const blank = loading || unavailable
  return (
    <Card className={`sys-page-stat${tone && !blank ? ` is-${tone}` : ''}`}>
      <div className="sys-page-stat-head">
        <span className="sys-page-stat-title">{title}</span>
        <span className="sys-page-stat-icon">{icon}</span>
      </div>
      <div className="sys-page-stat-value tabular-nums">
        {loading ? (
          <Skeleton.Input active size="small" className="sys-page-stat-skeleton" />
        ) : unavailable ? (
          <span className="muted">—</span>
        ) : (
          fmtInt(value)
        )}
      </div>
      <div className="sys-page-stat-foot" title={blank ? undefined : footTitle}>
        {loading ? <span className="muted">—</span> : unavailable ? '加载失败' : foot}
      </div>
    </Card>
  )
}

/** 0 值弱化显示，让有积压的队列一眼跳出来 */
function Num({ v, suffix = '' }: { v: number; suffix?: string }) {
  return (
    <span className={`tabular-nums${v === 0 ? ' muted' : ''}`}>
      {fmtInt(v)}
      {suffix}
    </span>
  )
}

export default function SystemStatus() {
  const qc = useQueryClient()
  const screens = Grid.useBreakpoint()
  const logTableRef = useRef<ActionType>(null)

  const [statusQuery, statsQuery, workloadQuery] = useQueries({
    queries: [
      { queryKey: ['system-status'], queryFn: fetchSystemStatus },
      { queryKey: ['queue-stats'], queryFn: fetchQueueStats },
      { queryKey: ['queue-workload'], queryFn: fetchQueueWorkload },
    ],
  })

  const status = statusQuery.data
  const stats = statsQuery.data
  const workload = workloadQuery.data ?? []
  const refreshing =
    statusQuery.isFetching || statsQuery.isFetching || workloadQuery.isFetching

  function reloadAll() {
    for (const k of ['system-status', 'queue-stats', 'queue-workload']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
    logTableRef.current?.reload()
  }

  const failed = stats?.failedJobs ?? 0
  const paused = stats?.pausedMasters ?? 0
  const lastRun = status?.schedule_last_runtime
  const lastRunAgo = ago(lastRun)
  const statsLoading = statsQuery.isLoading
  const statsUnavailable = !stats && statsQuery.isError

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="运行状态"
        extra={
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={reloadAll}>
            刷新
          </Button>
        }
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <HealthTile
              icon={<ScheduleOutlined />}
              title="计划任务"
              loading={statusQuery.isLoading}
              ok={!!status?.schedule}
              okText="正常"
              badText="未运行"
              detail={
                <>
                  <span className="sys-page-nowrap">
                    最后执行 <span className="tabular-nums">{formatTime(lastRun, '从未执行')}</span>
                  </span>
                  {lastRunAgo && (
                    <>
                      {' '}
                      <span className="sys-page-health-ago sys-page-nowrap">· {lastRunAgo}</span>
                    </>
                  )}
                </>
              }
            />
          </Col>
          <Col xs={24} md={12}>
            <HealthTile
              icon={<ClusterOutlined />}
              title="队列 (Horizon)"
              loading={statusQuery.isLoading}
              ok={!!status?.horizon}
              okText="正常"
              badText="未运行或已暂停"
              detail={
                stats ? (
                  <>
                    <span className="tabular-nums">{stats.processes}</span> 个进程
                  </>
                ) : (
                  '—'
                )
              }
            />
          </Col>
        </Row>

        {status && !status.schedule && (
          <Alert
            type="error"
            showIcon
            className="sys-page-alert"
            message="计划任务没在跑"
            description={
              <>
                流量重置、订单超时取消、佣金确认、统计数据都依赖它。请确认 crontab 里有：
                <Typography.Text code className="sys-page-cron">
                  * * * * * php /path/to/v2board/artisan schedule:run &gt;&gt; /dev/null 2&gt;&amp;1
                </Typography.Text>
                。判定口径是「最后执行时间在 120 秒内」。
              </>
            }
          />
        )}
        {status && !status.horizon && (
          <Alert
            type="error"
            showIcon
            className="sys-page-alert"
            message="队列没在跑"
            description="订单支付后不会开通订阅（会停在「开通中」）、邮件不会发出。启动命令：php artisan horizon"
          />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <StatCard
            title="近期任务数"
            value={stats?.recentJobs ?? 0}
            loading={statsLoading}
            unavailable={statsUnavailable}
            icon={<ThunderboltOutlined />}
            foot={periodText(stats?.periods?.recentJobs) ?? 'Horizon 近期窗口'}
          />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard
            title="失败任务数"
            value={failed}
            loading={statsLoading}
            unavailable={statsUnavailable}
            icon={<ExclamationCircleOutlined />}
            tone={failed > 0 ? 'error' : undefined}
            foot={periodText(stats?.periods?.failedJobs) ?? 'Horizon 失败窗口'}
          />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard
            title="每分钟处理"
            value={stats?.jobsPerMinute ?? 0}
            loading={statsLoading}
            unavailable={statsUnavailable}
            icon={<DashboardOutlined />}
            footTitle={
              stats?.queueWithMaxThroughput
                ? `吞吐最高 ${stats.queueWithMaxThroughput}`
                : undefined
            }
            foot={
              stats?.queueWithMaxThroughput ? (
                <>
                  吞吐最高 <span className="mono">{stats.queueWithMaxThroughput}</span>
                </>
              ) : (
                '—'
              )
            }
          />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard
            title="暂停的主管进程"
            value={paused}
            loading={statsLoading}
            unavailable={statsUnavailable}
            icon={<PauseCircleOutlined />}
            tone={paused > 0 ? 'warning' : undefined}
            foot={paused > 0 ? '有主管进程被暂停' : '全部运行中'}
          />
        </Col>
      </Row>

      <Card
        className="sys-page-queue"
        title={
          <Space size={8} wrap>
            <span>队列负载</span>
            <Typography.Text type="secondary" className="sys-page-card-sub">
              指标全部来自 Horizon 的仓库接口，Horizon 没跑时会是 0
            </Typography.Text>
          </Space>
        }
      >
        <Table<QueueWorkloadItem>
          rowKey="name"
          size="middle"
          loading={workloadQuery.isFetching}
          dataSource={workload}
          pagination={false}
          // 只有 4 个短列：放得下就不横向滚动，手机上数值列收窄（见下方宽度）
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '队列',
              dataIndex: 'name',
              render: (v: string) => <span className="mono">{v}</span>,
            },
            {
              title: '积压任务',
              dataIndex: 'length',
              width: screens.md ? 120 : 70,
              align: 'right',
              render: (v: number) => <Num v={v} />,
            },
            {
              title: '预计等待',
              dataIndex: 'wait',
              width: screens.md ? 120 : 70,
              align: 'right',
              render: (v: number) => <Num v={v} suffix=" 秒" />,
            },
            {
              title: '进程数',
              dataIndex: 'processes',
              width: screens.md ? 100 : 58,
              align: 'right',
              render: (v: number) => <Num v={v} />,
            },
          ]}
          locale={{ emptyText: '队列空闲或 Horizon 未运行' }}
        />
      </Card>

      <ProTable<SystemLogItem>
        actionRef={logTableRef}
        rowKey="id"
        className="sys-page-log"
        headerTitle={
          <Space size={8} wrap>
            <span>系统日志</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              v2_log 表，由 RequestLog 中间件写入（只挂在部分路由上）
            </Typography.Text>
          </Space>
        }
        request={async (params) =>
          proTableRequest<SystemLogItem>(ADMIN_ENDPOINTS.system.getSystemLog, {
            current: params.current,
            // ⚠️ 这个接口的分页大小参数叫 page_size（下划线），
            // 不是其它接口用的 pageSize —— 传错会退回默认 10 条
            page_size: params.pageSize,
          }) as Promise<{ data: SystemLogItem[]; total: number; success: boolean }>
        }
        columns={[
          {
            title: 'ID',
            dataIndex: 'id',
            width: 76,
            render: (_, row) => <span className="tabular-nums">{row.id}</span>,
          },
          {
            title: '级别',
            dataIndex: 'level',
            width: 100,
            // ProTable 的 render 首参是 dom，取值要用 row
            render: (_, row) => (
              <Tag
                bordered={false}
                className="sys-page-level"
                color={LEVEL_COLOR[row.level?.toLowerCase()] ?? 'default'}
              >
                {row.level}
              </Tag>
            ),
          },
          {
            title: '标题',
            dataIndex: 'title',
            width: 280,
            ellipsis: true,
            render: (_, row) =>
              row.title ? (
                <span className="mono">{row.title}</span>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: '方法',
            dataIndex: 'method',
            width: 80,
            render: (_, row) =>
              row.method ? (
                <span className="mono sys-page-method">{row.method}</span>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: 'URI',
            dataIndex: 'uri',
            ellipsis: true,
            render: (_, row) =>
              row.uri ? (
                <span className="mono muted">{row.uri}</span>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: 'IP',
            dataIndex: 'ip',
            width: 140,
            render: (_, row) =>
              row.ip ? (
                <span className="mono sys-page-nowrap">{row.ip}</span>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: '时间',
            dataIndex: 'created_at',
            width: 160,
            render: (_, row) => (
              <span className="tabular-nums sys-page-nowrap">{formatTime(row.created_at)}</span>
            ),
          },
        ]}
        expandable={{
          // 日志内容来自请求/异常，只当纯文本展示
          expandedRowRender: (row) => {
            const data = prettyData(row.data)
            return (
              <div className="sys-page-log-detail">
                <dl className="sys-page-log-meta">
                  <dt>标题</dt>
                  <dd className="mono">{row.title || '—'}</dd>
                  <dt>请求</dt>
                  <dd className="mono">
                    {[row.method, row.host, row.uri].filter(Boolean).join(' ') || '—'}
                  </dd>
                  <dt>来源</dt>
                  <dd className="mono">
                    <span className="sys-page-nowrap">{row.ip || '—'}</span>
                    <span className="muted"> · </span>
                    <span className="muted sys-page-nowrap">{formatTime(row.created_at)}</span>
                  </dd>
                </dl>
                <div className="sys-page-log-label">附加数据</div>
                {data ? (
                  <pre className="code-block sys-page-log-data">{data}</pre>
                ) : (
                  <Typography.Text type="secondary">（无附加数据）</Typography.Text>
                )}
              </div>
            )
          },
        }}
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50],
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        scroll={{ x: 1080 }}
      />
    </Space>
  )
}
