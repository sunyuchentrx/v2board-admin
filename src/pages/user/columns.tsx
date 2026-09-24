import type { ReactNode } from 'react'
import { Progress, Tag, Tooltip, Typography } from 'antd'
import type { ProColumns } from '@ant-design/pro-table'
import type { AdminUser } from '@/api/user'
import {
  formatBytes,
  formatMoney,
  formatTime,
  isExpired,
} from '@/lib/format'
import './UserList.css'

/**
 * 表格列定义。
 *
 * 只声明展示用的列 —— 后端 user/fetch 实际返回 38 个字段（含 password 哈希），
 * 这里刻意不碰那些敏感字段。
 *
 * search: false 是默认策略：后端的过滤是 filter[n][key|condition|value] 的自定义
 * 格式，且键有白名单，无法用 ProTable 的自动搜索表单直接对上，所以搜索区单独实现。
 *
 * 宽度预算：默认显示的列加上操作列要能一屏放下，否则固定在右侧的操作列会盖住紧挨着它的那一列
 * （原来盖住的是余额 / 佣金）。按 1280 宽的笔记本算（侧栏展开时表格可用宽度约 950px）：
 * 套餐和到期时间合成一列、余额和佣金合成一列、备注和角色标签放到邮箱下面一行；
 * 最后登录 / 注册时间默认隐藏，需要时从表格右上角的列设置里打开（打开后表格会自动出现横向滚动）。
 */

/** 默认隐藏的列（key），见上面的宽度预算 */
export const USER_COLUMNS_HIDDEN_BY_DEFAULT = ['last_login_at', 'created_at'] as const

/** 到期前多少天开始用警告色提醒 */
const EXPIRE_SOON_DAYS = 3

function Empty({ children = '—' }: { children?: ReactNode }) {
  return <Typography.Text type="secondary">{children}</Typography.Text>
}

/** 订阅列的第二行：到期时间（null / 0 两种「无到期」语义见 formatExpire） */
function ExpireLine({ expiredAt }: { expiredAt: number | null | undefined }) {
  if (expiredAt === null || expiredAt === undefined) {
    return <span className="user-page-sub is-success">长期有效</span>
  }
  if (expiredAt === 0) {
    return <span className="user-page-sub">未订阅</span>
  }
  if (isExpired(expiredAt)) {
    return (
      <Tooltip title="已过期">
        <span className="user-page-sub is-danger">过期 {formatTime(expiredAt)}</span>
      </Tooltip>
    )
  }
  const daysLeft = Math.ceil((expiredAt * 1000 - Date.now()) / 86400000)
  const soon = daysLeft <= EXPIRE_SOON_DAYS
  return (
    <Tooltip title={`还剩 ${daysLeft} 天`}>
      <span className={`user-page-sub${soon ? ' is-warning' : ''}`}>
        到期 {formatTime(expiredAt)}
      </span>
    </Tooltip>
  )
}

export function buildUserColumns({
  pin = true,
}: {
  /** 是否把 ID / 邮箱固定在左侧。手机上固定列会占掉大半屏，只剩一条缝能滚动，所以关掉 */
  pin?: boolean
} = {}): ProColumns<AdminUser>[] {
  return [
    {
      title: 'ID',
      key: 'id',
      dataIndex: 'id',
      width: 68,
      fixed: pin ? 'left' : undefined,
      sorter: true,
      render: (_, row) => <span className="user-page-id">{row.id}</span>,
    },
    {
      title: '邮箱',
      key: 'email',
      dataIndex: 'email',
      width: 208,
      fixed: pin ? 'left' : undefined,
      render: (_, row) => {
        const isAdmin = row.is_admin === 1
        const isStaff = row.is_staff === 1
        return (
          <div className="user-page-cell">
            <Typography.Text
              className="user-page-email"
              copyable={{ text: row.email, tooltips: ['复制邮箱', '已复制'] }}
              ellipsis={{ tooltip: row.email }}
            >
              {row.email}
            </Typography.Text>
            {/* 角色标签和备注放第二行：放在邮箱后面会把最该看清的邮箱挤成省略号 */}
            {(isAdmin || isStaff || row.remarks) && (
              <div className="user-page-line">
                {isAdmin && (
                  <Tag bordered={false} color="processing" className="user-page-tag">
                    管理员
                  </Tag>
                )}
                {isStaff && (
                  <Tag bordered={false} color="purple" className="user-page-tag">
                    员工
                  </Tag>
                )}
                {row.remarks && (
                  <Typography.Text
                    className="user-page-sub user-page-remark"
                    ellipsis={{ tooltip: row.remarks }}
                  >
                    {row.remarks}
                  </Typography.Text>
                )}
              </div>
            )}
          </div>
        )
      },
    },
    {
      title: '状态',
      key: 'banned',
      dataIndex: 'banned',
      width: 80,
      render: (_, row) =>
        row.banned === 1 ? (
          <Tag bordered={false} color="error">
            已封禁
          </Tag>
        ) : (
          <Tag bordered={false} color="success">
            正常
          </Tag>
        ),
    },
    {
      // 套餐 + 到期时间合成一列；排序仍按到期时间（dataIndex 就是后端的 sort 字段）
      title: '订阅 / 到期',
      key: 'expired_at',
      dataIndex: 'expired_at',
      width: 160,
      sorter: true,
      render: (_, row) => {
        // 全新用户：没套餐也没到期时间，一行「无订阅」就够了
        if (!row.plan_name && row.expired_at === 0) return <Empty>无订阅</Empty>
        return (
          <div className="user-page-cell">
            {row.plan_name ? (
              <Typography.Text ellipsis={{ tooltip: row.plan_name }}>
                {row.plan_name}
              </Typography.Text>
            ) : (
              <Empty>无套餐</Empty>
            )}
            <ExpireLine expiredAt={row.expired_at} />
          </div>
        )
      },
    },
    {
      title: '流量',
      key: 'total_used',
      dataIndex: 'total_used',
      width: 152,
      sorter: true,
      render: (_, row) => {
        // transfer_enable = 0 表示没有配额（新建用户 / 无订阅），
        // 此时算百分比会除零，直接显示已用量
        if (!row.transfer_enable) {
          return (
            <div className="user-page-cell">
              <span className="user-page-traffic-text">{formatBytes(row.total_used)}</span>
              <span className="user-page-sub">未设配额</span>
            </div>
          )
        }
        const ratio = row.total_used / row.transfer_enable
        const percent = Math.min(100, Math.round(ratio * 100))
        // 超额（红）按四舍五入后的 percent 判断，和进度条 / tooltip 里显示的「已用 100%」一致
        const exceeded = percent >= 100
        const level = exceeded ? 'is-danger' : ratio >= 0.8 ? 'is-warning' : ''
        return (
          <Tooltip
            title={
              <div className="tabular-nums">
                <div>已用 {percent}%</div>
                <div>上行 {formatBytes(row.u)}</div>
                <div>下行 {formatBytes(row.d)}</div>
              </div>
            }
          >
            <div className={`user-page-traffic ${level}`}>
              <div className="user-page-traffic-text">
                {formatBytes(row.total_used)}
                <span className="user-page-traffic-total">
                  {' / '}
                  {formatBytes(row.transfer_enable)}
                </span>
              </div>
              <Progress
                percent={percent}
                size="small"
                showInfo={false}
                status={exceeded ? 'exception' : 'normal'}
                strokeColor={ratio >= 0.8 && !exceeded ? 'var(--va-color-warning)' : undefined}
              />
            </div>
          </Tooltip>
        )
      },
    },
    {
      title: '设备',
      key: 'alive_ip',
      dataIndex: 'alive_ip',
      width: 76,
      render: (_, row) => {
        const limit = row.device_limit
        const label = (
          <span className={row.alive_ip ? undefined : 'muted'}>
            {row.alive_ip}
            <span className="muted"> / {limit || '∞'}</span>
          </span>
        )
        const tip = (
          <>
            <div>
              在线 {row.alive_ip} 台，{limit ? `上限 ${limit} 台` : '不限设备数'}
            </div>
            {row.ips && <div className="mono">{row.ips}</div>}
          </>
        )
        return <Tooltip title={tip}>{label}</Tooltip>
      },
    },
    {
      // 余额 + 佣金合成一列（见文件头的宽度预算），两行右对齐
      title: '余额 / 佣金',
      key: 'balance',
      dataIndex: 'balance',
      width: 108,
      align: 'right',
      render: (_, row) => (
        <div className="user-page-cell user-page-money">
          <span className={row.balance ? undefined : 'muted'}>{formatMoney(row.balance)}</span>
          <span className={`user-page-sub${row.commission_balance ? ' is-active' : ''}`}>
            佣金 {formatMoney(row.commission_balance)}
          </span>
        </div>
      ),
    },
    {
      title: '最后登录',
      key: 'last_login_at',
      dataIndex: 'last_login_at',
      width: 160,
      sorter: true,
      render: (_, row) =>
        row.last_login_at ? formatTime(row.last_login_at) : <Empty>从未登录</Empty>,
    },
    {
      title: '注册时间',
      key: 'created_at',
      dataIndex: 'created_at',
      width: 160,
      sorter: true,
      render: (_, row) => formatTime(row.created_at),
    },
  ]
}
