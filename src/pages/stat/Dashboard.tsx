import {
  Alert,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Typography,
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Button } from 'antd'
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
import TrendChart from './TrendChart'

/** 环比：本月 vs 上月 */
function MoMTag({ current, previous }: { current: number; previous: number }) {
  if (!previous) return null
  const delta = ((current - previous) / previous) * 100
  const up = delta >= 0
  return (
    <Typography.Text
      type={up ? 'success' : 'danger'}
      style={{ fontSize: 12, marginLeft: 6 }}
    >
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {Math.abs(delta).toFixed(1)}%
    </Typography.Text>
  )
}

export default function Dashboard() {
  const qc = useQueryClient()

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

  const serverColumns = [
    {
      title: '节点',
      dataIndex: 'server_name',
      render: (v: string | undefined, row: ServerRankItem) =>
        v ?? `#${row.server_id}`,
    },
    { title: '协议', dataIndex: 'server_type', width: 110 },
    {
      title: '流量',
      dataIndex: 'total',
      width: 110,
      // 后端已经换算成 GB
      render: (v: number) => `${v.toFixed(2)} GB`,
    },
  ]

  const userColumns = [
    {
      title: '用户',
      dataIndex: 'email',
      render: (v: string, row: UserRankItem) =>
        // 后端在用户已删除时返回字符串 "null"
        v && v !== 'null' ? v : (
          <Typography.Text type="secondary">已删除 #{row.user_id}</Typography.Text>
        ),
    },
    {
      title: '流量',
      dataIndex: 'total',
      width: 110,
      // 已按节点倍率加权后换算成 GB
      render: (v: number) => `${v.toFixed(2)} GB`,
    },
  ]

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Row justify="end">
          <Button icon={<ReloadOutlined />} onClick={reloadAll}>
            刷新
          </Button>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="在线用户"
                value={o?.online_user ?? 0}
                suffix={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    近 10 分钟
                  </Typography.Text>
                }
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="今日收款"
                value={centsToYuan(o?.day_income ?? 0)}
                precision={2}
                prefix="¥"
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={
                  <Space size={4}>
                    本月收款
                    <MoMTag
                      current={o?.month_income ?? 0}
                      previous={o?.last_month_income ?? 0}
                    />
                  </Space>
                }
                value={centsToYuan(o?.month_income ?? 0)}
                precision={2}
                prefix="¥"
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                上月 ¥{centsToYuan(o?.last_month_income ?? 0).toFixed(2)}
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={
                  <Space size={4}>
                    本月佣金支出
                    <MoMTag
                      current={o?.commission_month_payout ?? 0}
                      previous={o?.commission_last_month_payout ?? 0}
                    />
                  </Space>
                }
                value={centsToYuan(o?.commission_month_payout ?? 0)}
                precision={2}
                prefix="¥"
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                上月 ¥
                {centsToYuan(o?.commission_last_month_payout ?? 0).toFixed(2)}
              </Typography.Text>
            </Card>
          </Col>

          <Col xs={12} md={6}>
            <Card>
              <Statistic title="今日注册" value={o?.day_register_total ?? 0} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic title="本月注册" value={o?.month_register_total ?? 0} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="待处理工单"
                value={o?.ticket_pending_total ?? 0}
                valueStyle={
                  (o?.ticket_pending_total ?? 0) > 0
                    ? { color: '#cf1322' }
                    : undefined
                }
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="待确认佣金"
                value={o?.commission_pending_total ?? 0}
                valueStyle={
                  (o?.commission_pending_total ?? 0) > 0
                    ? { color: '#d46b08' }
                    : undefined
                }
              />
            </Card>
          </Col>
        </Row>

        <Card title="近 31 天趋势">
          {trendData.length === 0 ? (
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
            <TrendChart data={trendData} />
          )}
        </Card>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="节点流量排行" size="small">
              <Tabs
                size="small"
                items={[
                  {
                    key: 'today',
                    label: '今日',
                    children: (
                      <Table<ServerRankItem>
                        rowKey={(r) => `${r.server_type}-${r.server_id}`}
                        size="small"
                        pagination={false}
                        dataSource={serverToday.data ?? []}
                        columns={serverColumns}
                        locale={{ emptyText: <Empty description="今日暂无流量记录" /> }}
                      />
                    ),
                  },
                  {
                    key: 'yesterday',
                    label: '昨日',
                    children: (
                      <Table<ServerRankItem>
                        rowKey={(r) => `${r.server_type}-${r.server_id}`}
                        size="small"
                        pagination={false}
                        dataSource={serverLast.data ?? []}
                        columns={serverColumns}
                        locale={{ emptyText: <Empty description="昨日暂无流量记录" /> }}
                      />
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="用户流量排行" size="small">
              <Tabs
                size="small"
                items={[
                  {
                    key: 'today',
                    label: '今日',
                    children: (
                      <Table<UserRankItem>
                        rowKey="user_id"
                        size="small"
                        pagination={false}
                        dataSource={userToday.data ?? []}
                        columns={userColumns}
                        locale={{ emptyText: <Empty description="今日暂无流量记录" /> }}
                      />
                    ),
                  },
                  {
                    key: 'yesterday',
                    label: '昨日',
                    children: (
                      <Table<UserRankItem>
                        rowKey="user_id"
                        size="small"
                        pagination={false}
                        dataSource={userLast.data ?? []}
                        columns={userColumns}
                        locale={{ emptyText: <Empty description="昨日暂无流量记录" /> }}
                      />
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          说明：流量排行取 v2_stat_server / v2_stat_user 表，依赖节点上报与
          traffic_fetch 队列；「在线用户」按 v2_user.t 最近 10 分钟判定。
          节点排行只统计父节点（parent_id 为空）。
        </Typography.Text>
      </Space>
    </Spin>
  )
}
