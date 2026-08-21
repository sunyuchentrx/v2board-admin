import { Progress, Space, Tag, Tooltip, Typography } from 'antd'
import type { ProColumns } from '@ant-design/pro-table'
import type { AdminUser } from '@/api/user'
import {
  formatBytes,
  formatExpire,
  formatMoney,
  formatTime,
  isExpired,
} from '@/lib/format'

/**
 * 表格列定义。
 *
 * 只声明展示用的列 —— 后端 user/fetch 实际返回 38 个字段（含 password 哈希），
 * 这里刻意不碰那些敏感字段。
 *
 * search: false 是默认策略：后端的过滤是 filter[n][key|condition|value] 的自定义
 * 格式，且键有白名单，无法用 ProTable 的自动搜索表单直接对上，所以搜索区单独实现。
 */
export function buildUserColumns(): ProColumns<AdminUser>[] {
  return [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 72,
      fixed: 'left',
      sorter: true,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 210,
      fixed: 'left',
      copyable: true,
      ellipsis: true,
      render: (_, row) => (
        <Space size={4} wrap={false}>
          <Typography.Text
            copyable={{ text: row.email }}
            style={{ maxWidth: 150 }}
            ellipsis
          >
            {row.email}
          </Typography.Text>
          {row.is_admin === 1 && <Tag color="red">管理员</Tag>}
          {row.is_staff === 1 && <Tag color="orange">员工</Tag>}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'banned',
      width: 80,
      render: (_, row) =>
        row.banned === 1 ? (
          <Tag color="error">已封禁</Tag>
        ) : (
          <Tag color="success">正常</Tag>
        ),
    },
    {
      title: '订阅',
      dataIndex: 'plan_name',
      width: 120,
      ellipsis: true,
      render: (_, row) =>
        row.plan_name ? (
          row.plan_name
        ) : (
          <Typography.Text type="secondary">无订阅</Typography.Text>
        ),
    },
    {
      title: '流量',
      dataIndex: 'total_used',
      width: 170,
      sorter: true,
      render: (_, row) => {
        // transfer_enable = 0 表示没有配额（新建用户 / 无订阅），
        // 此时算百分比会除零，直接显示已用量
        if (!row.transfer_enable) {
          return (
            <Tooltip title={`已用 ${formatBytes(row.total_used)}，未设配额`}>
              <Typography.Text type="secondary">
                {formatBytes(row.total_used)} / 无配额
              </Typography.Text>
            </Tooltip>
          )
        }
        const percent = Math.min(
          100,
          Math.round((row.total_used / row.transfer_enable) * 100),
        )
        return (
          <Tooltip
            title={`上行 ${formatBytes(row.u)} / 下行 ${formatBytes(row.d)}`}
          >
            <div style={{ minWidth: 150 }}>
              <Typography.Text style={{ fontSize: 12 }}>
                {formatBytes(row.total_used)} / {formatBytes(row.transfer_enable)}
              </Typography.Text>
              <Progress
                percent={percent}
                size="small"
                showInfo={false}
                status={percent >= 100 ? 'exception' : 'normal'}
              />
            </div>
          </Tooltip>
        )
      },
    },
    {
      title: '到期时间',
      dataIndex: 'expired_at',
      width: 150,
      sorter: true,
      render: (_, row) => {
        const text = formatExpire(row.expired_at)
        if (row.expired_at === null || row.expired_at === undefined) {
          return <Tag color="blue">长期有效</Tag>
        }
        if (row.expired_at === 0) {
          return <Typography.Text type="secondary">未订阅</Typography.Text>
        }
        return (
          <Typography.Text type={isExpired(row.expired_at) ? 'danger' : undefined}>
            {text}
          </Typography.Text>
        )
      },
    },
    {
      title: '在线设备',
      dataIndex: 'alive_ip',
      width: 100,
      render: (_, row) => {
        const limit = row.device_limit
        const label = limit ? `${row.alive_ip} / ${limit}` : String(row.alive_ip)
        return row.ips ? <Tooltip title={row.ips}>{label}</Tooltip> : label
      },
    },
    {
      title: '余额',
      dataIndex: 'balance',
      width: 90,
      render: (_, row) => formatMoney(row.balance),
    },
    {
      title: '佣金',
      dataIndex: 'commission_balance',
      width: 90,
      render: (_, row) => formatMoney(row.commission_balance),
    },
    {
      title: '备注',
      dataIndex: 'remarks',
      width: 140,
      ellipsis: true,
      render: (_, row) =>
        row.remarks || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '最后登录',
      dataIndex: 'last_login_at',
      width: 150,
      sorter: true,
      render: (_, row) => formatTime(row.last_login_at, '从未登录'),
    },
    {
      title: '注册时间',
      dataIndex: 'created_at',
      width: 150,
      sorter: true,
      render: (_, row) => formatTime(row.created_at),
    },
  ]
}
