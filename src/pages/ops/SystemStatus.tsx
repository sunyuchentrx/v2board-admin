import { useRef } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
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

const LEVEL_COLOR: Record<string, string> = {
  emergency: 'red',
  alert: 'red',
  critical: 'red',
  error: 'red',
  warning: 'orange',
  notice: 'blue',
  info: 'blue',
  debug: 'default',
}

export default function SystemStatus() {
  const qc = useQueryClient()
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

  function reloadAll() {
    for (const k of ['system-status', 'queue-stats', 'queue-workload']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
    logTableRef.current?.reload()
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row justify="end">
        <Button icon={<ReloadOutlined />} onClick={reloadAll}>
          刷新
        </Button>
      </Row>

      <Card title="运行状态" size="small">
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8}>
            <Space direction="vertical" size={2}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                计划任务
              </Typography.Text>
              <Badge
                status={status?.schedule ? 'success' : 'error'}
                text={status?.schedule ? '正常' : '未运行'}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                最后执行 {formatTime(status?.schedule_last_runtime, '从未执行')}
              </Typography.Text>
            </Space>
          </Col>
          <Col xs={12} md={8}>
            <Space direction="vertical" size={2}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                队列 (Horizon)
              </Typography.Text>
              <Badge
                status={status?.horizon ? 'success' : 'error'}
                text={status?.horizon ? '正常' : '未运行或已暂停'}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {stats ? `${stats.processes} 个进程` : '—'}
              </Typography.Text>
            </Space>
          </Col>
        </Row>

        {status && !status.schedule && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 12 }}
            message="计划任务没在跑"
            description={
              <>
                流量重置、订单超时取消、佣金确认、统计数据都依赖它。请确认 crontab 里有：
                <Typography.Text code>
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
            style={{ marginTop: 12 }}
            message="队列没在跑"
            description="订单支付后不会开通订阅（会停在「开通中」）、邮件不会发出。启动命令：php artisan horizon"
          />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="近期任务数" value={stats?.recentJobs ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="失败任务数"
              value={stats?.failedJobs ?? 0}
              valueStyle={(stats?.failedJobs ?? 0) > 0 ? { color: '#cf1322' } : undefined}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="每分钟处理" value={stats?.jobsPerMinute ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="暂停的主管进程"
              value={stats?.pausedMasters ?? 0}
              valueStyle={
                (stats?.pausedMasters ?? 0) > 0 ? { color: '#d46b08' } : undefined
              }
            />
          </Card>
        </Col>
      </Row>

      <Card title="队列负载" size="small">
        <Table<QueueWorkloadItem>
          rowKey="name"
          size="small"
          loading={workloadQuery.isFetching}
          dataSource={workloadQuery.data ?? []}
          pagination={false}
          columns={[
            { title: '队列', dataIndex: 'name' },
            { title: '积压任务', dataIndex: 'length', width: 110 },
            {
              title: '预计等待',
              dataIndex: 'wait',
              width: 110,
              render: (v: number) => `${v} 秒`,
            },
            { title: '进程数', dataIndex: 'processes', width: 100 },
          ]}
          locale={{ emptyText: '队列空闲或 Horizon 未运行' }}
        />
      </Card>

      <ProTable<SystemLogItem>
        actionRef={logTableRef}
        rowKey="id"
        headerTitle="系统日志"
        request={async (params) =>
          proTableRequest<SystemLogItem>(ADMIN_ENDPOINTS.system.getSystemLog, {
            current: params.current,
            // ⚠️ 这个接口的分页大小参数叫 page_size（下划线），
            // 不是其它接口用的 pageSize —— 传错会退回默认 10 条
            page_size: params.pageSize,
          }) as Promise<{ data: SystemLogItem[]; total: number; success: boolean }>
        }
        columns={[
          { title: 'ID', dataIndex: 'id', width: 80 },
          {
            title: '级别',
            dataIndex: 'level',
            width: 100,
            // ProTable 的 render 首参是 dom，取值要用 row
            render: (_, row) => (
              <Tag color={LEVEL_COLOR[row.level?.toLowerCase()] ?? 'default'}>
                {row.level}
              </Tag>
            ),
          },
          { title: '标题', dataIndex: 'title', width: 200, ellipsis: true },
          { title: '方法', dataIndex: 'method', width: 80 },
          { title: 'URI', dataIndex: 'uri', ellipsis: true },
          { title: 'IP', dataIndex: 'ip', width: 130 },
          {
            title: '时间',
            dataIndex: 'created_at',
            width: 150,
            render: (_, row) => formatTime(row.created_at),
          },
        ]}
        expandable={{
          expandedRowRender: (row) => (
            <Typography.Paragraph
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: 12,
                marginBottom: 0,
              }}
            >
              {row.data || '（无附加数据）'}
            </Typography.Paragraph>
          ),
        }}
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50],
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        scroll={{ x: 1100 }}
      />

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        说明：队列指标全部来自 Horizon 的仓库接口，Horizon 没跑时会是 0。
        日志表是 v2_log，由 RequestLog 中间件写入（只挂在部分路由上）。
      </Typography.Text>
    </Space>
  )
}
