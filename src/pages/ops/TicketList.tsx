import { Fragment, useEffect, useRef, useState } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  Empty,
  Form,
  Grid,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  CloseCircleOutlined,
  CustomerServiceOutlined,
  LockOutlined,
  MailOutlined,
  MessageOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import {
  closeTicket,
  fetchTicketDetail,
  replyTicket,
  TICKET_LEVELS,
  TICKET_REPLY_STATUS,
  TICKET_STATUS,
  type AdminTicket,
} from '@/api/ops'
import { formatTime } from '@/lib/format'
import RowActions from '@/components/RowActions'
import './TicketList.css'

/** 级别 → Tag 颜色（高=error、中=warning、低=default，与全站语义色一致） */
function levelColor(level: number): string {
  return level === 2 ? 'error' : level === 1 ? 'warning' : 'default'
}

function levelLabel(level: number): string {
  return TICKET_LEVELS[level as keyof typeof TICKET_LEVELS] ?? String(level)
}

function StatusTag({ status }: { status: number }) {
  return (
    <Tag bordered={false} color={status === 0 ? 'processing' : 'default'}>
      {TICKET_STATUS[status as keyof typeof TICKET_STATUS] ?? status}
    </Tag>
  )
}

/** 'YYYY-MM-DD HH:mm' 拆成日期与时间，用于会话里的日期分隔条 */
function splitTime(seconds: number): [string, string] {
  const s = formatTime(seconds)
  return s.length >= 16 ? [s.slice(0, 10), s.slice(11)] : [s, '']
}

export default function TicketList() {
  const qc = useQueryClient()
  const screens = Grid.useBreakpoint()
  const tableRef = useRef<ActionType>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [replyForm] = Form.useForm<{ message: string }>()
  const [replying, setReplying] = useState(false)
  /**
   * 同步防重：按钮的 loading 只拦得住点击，Ctrl/⌘+Enter 快捷键和按键自动重复会绕过它；
   * state 要等下一次渲染才生效，连按两次会在那之前发出两条回复，所以用 ref。
   */
  const replyingRef = useRef(false)
  /** 三个专用过滤参数（不是通用 filter[] 三元组） */
  const [status, setStatus] = useState<0 | 1 | undefined>(undefined)
  const [replyStatus, setReplyStatus] = useState<number[] | undefined>(undefined)
  const [email, setEmail] = useState<string>('')

  const reload = () => tableRef.current?.reload()

  const { data: detail, isFetching: loadingDetail } = useQuery({
    queryKey: ['ticket-detail', openId],
    queryFn: () => fetchTicketDetail(openId!),
    enabled: openId !== null,
  })

  // 打开工单 / 发出回复后，会话滚到最新一条
  const messageCount = detail?.message.length ?? 0
  useEffect(() => {
    if (openId === null || messageCount === 0) return
    const t = window.setTimeout(() => threadEndRef.current?.scrollIntoView({ block: 'end' }), 60)
    return () => window.clearTimeout(t)
  }, [openId, detail?.id, messageCount])

  async function submitReply() {
    if (replyingRef.current) return
    replyingRef.current = true
    try {
      const values = await replyForm.validateFields().catch(() => null)
      if (!values || !openId) return
      setReplying(true)
      try {
        await replyTicket(openId, values.message)
        message.success('已回复')
        replyForm.resetFields()
        qc.invalidateQueries({ queryKey: ['ticket-detail', openId] })
        reload()
      } catch {
        // 拦截器已提示
      } finally {
        setReplying(false)
      }
    } finally {
      replyingRef.current = false
    }
  }

  function resetFilters() {
    setStatus(undefined)
    setReplyStatus(undefined)
    setEmail('')
    setTimeout(reload, 0)
  }

  // 注意：工单内容由终端用户提交，只能当纯文本渲染（React 自动转义），不要改成 HTML / Markdown 渲染
  const thread = detail ? (
    detail.message.length === 0 ? (
      <Empty className="ticket-page-empty" description="暂无消息" />
    ) : (
      <div className="ticket-page-thread">
        {detail.message.map((m, i) => {
          const [day, time] = splitTime(m.created_at)
          const prev = detail.message[i - 1]
          const prevDay = prev ? splitTime(prev.created_at)[0] : null
          // is_me = 发信人不是工单创建者，即客服/管理员
          const fromAdmin = m.is_me
          return (
            <Fragment key={m.id}>
              {day !== prevDay && (
                <div className="ticket-page-day">
                  <span>{day}</span>
                </div>
              )}
              <div className={`ticket-page-msg ${fromAdmin ? 'is-admin' : 'is-user'}`}>
                <Avatar
                  size={32}
                  className="ticket-page-avatar"
                  icon={fromAdmin ? <CustomerServiceOutlined /> : <UserOutlined />}
                />
                <div className="ticket-page-msg-body">
                  <div className="ticket-page-msg-meta">
                    <span className="ticket-page-msg-name">
                      {fromAdmin ? '客服' : `用户 #${detail.user_id}`}
                    </span>
                    <span className="tabular-nums">{time}</span>
                  </div>
                  <div className="ticket-page-bubble">{m.message}</div>
                </div>
              </div>
            </Fragment>
          )
        })}
        <div ref={threadEndRef} />
      </div>
    )
  ) : (
    !loadingDetail && <Empty className="ticket-page-empty" description="工单不存在" />
  )

  const composer = detail ? (
    detail.status === 0 ? (
      <Form form={replyForm} layout="vertical" className="ticket-page-composer">
        <Form.Item
          name="message"
          rules={[{ required: true, message: '回复不能为空' }]}
          className="ticket-page-composer-input"
        >
          <Input.TextArea
            aria-label="回复内容"
            placeholder="输入回复内容…"
            // 手机上会话区本来就矮，弹出软键盘后更少，回复框最多涨到 4 行
            autoSize={{ minRows: screens.md ? 3 : 2, maxRows: screens.md ? 8 : 4 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                // 按住不放的自动重复不算新的一次发送
                if (e.repeat) return
                submitReply()
              }
            }}
          />
        </Form.Item>
        <div className="ticket-page-composer-bar">
          <Typography.Text type="secondary" className="ticket-page-composer-hint">
            Ctrl + Enter 发送 · 用户会在工单页看到回复
          </Typography.Text>
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={replying}
            onClick={submitReply}
          >
            发送回复
          </Button>
        </div>
      </Form>
    ) : (
      <div className="ticket-page-closed">
        <LockOutlined />
        <span>工单已关闭，不能再回复。</span>
      </div>
    )
  ) : null

  return (
    <>
      <div className="ticket-page-filter">
        <div className="ticket-page-filter-fields">
          <Select<0 | 1>
            className="ticket-page-filter-status"
            allowClear
            placeholder="工单状态"
            value={status}
            onChange={setStatus}
            options={Object.entries(TICKET_STATUS).map(([v, l]) => ({
              value: Number(v) as 0 | 1,
              label: l,
            }))}
          />
          <Select<number[]>
            className="ticket-page-filter-reply"
            allowClear
            mode="multiple"
            // 手机上框只有 ~160px，responsive 一个标签都放不下、只剩「+ 2 ...」，固定留一个标签
            maxTagCount={screens.md ? 'responsive' : 1}
            maxTagPlaceholder={(omitted) => `+${omitted.length}`}
            placeholder="回复状态"
            value={replyStatus}
            onChange={setReplyStatus}
            options={Object.entries(TICKET_REPLY_STATUS).map(([v, l]) => ({
              value: Number(v),
              label: l,
            }))}
          />
          <Input
            className="ticket-page-filter-email"
            allowClear
            prefix={<MailOutlined className="ticket-page-filter-icon" />}
            placeholder="用户邮箱（需完整匹配）"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onPressEnter={reload}
          />
        </div>
        <div className="ticket-page-filter-actions">
          <Button icon={<ReloadOutlined />} onClick={resetFilters}>
            重置
          </Button>
          <Button type="primary" icon={<SearchOutlined />} onClick={reload}>
            查询
          </Button>
        </div>
      </div>

      <ProTable<AdminTicket>
        actionRef={tableRef}
        rowKey="id"
        request={async (params) =>
          proTableRequest<AdminTicket>(ADMIN_ENDPOINTS.ticket.fetch, {
            current: params.current,
            pageSize: params.pageSize,
            ...(status !== undefined ? { status } : {}),
            ...(replyStatus && replyStatus.length > 0 ? { reply_status: replyStatus } : {}),
            ...(email.trim() ? { email: email.trim() } : {}),
          }) as Promise<{ data: AdminTicket[]; total: number; success: boolean }>
        }
        columns={[
          {
            title: 'ID',
            dataIndex: 'id',
            width: 64,
            render: (_, row) => <span className="tabular-nums">{row.id}</span>,
          },
          {
            title: '主题',
            dataIndex: 'subject',
            ellipsis: true,
            // 开启且待回复的工单加粗，像未读邮件一样一眼能看出要处理的
            render: (_, row) => (
              <span
                className={
                  row.status === 0 && row.reply_status === 0
                    ? 'ticket-page-subject is-pending'
                    : 'ticket-page-subject'
                }
              >
                {row.subject}
              </span>
            ),
          },
          {
            title: '用户',
            dataIndex: 'user_id',
            width: 76,
            // 注意 ProTable 的 render 首参是已渲染的 dom，不是字段值（和 antd Table 不同）
            render: (_, row) => (
              <Typography.Text type="secondary" className="tabular-nums">
                #{row.user_id}
              </Typography.Text>
            ),
          },
          {
            title: '级别',
            dataIndex: 'level',
            width: 72,
            render: (_, row) => (
              <Tag bordered={false} color={levelColor(row.level)}>
                {levelLabel(row.level)}
              </Tag>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 84,
            render: (_, row) => <StatusTag status={row.status} />,
          },
          {
            title: '回复',
            dataIndex: 'reply_status',
            width: 88,
            render: (_, row) => (
              <Badge
                status={row.reply_status === 0 ? 'warning' : 'success'}
                text={
                  TICKET_REPLY_STATUS[
                    row.reply_status as keyof typeof TICKET_REPLY_STATUS
                  ] ?? row.reply_status
                }
              />
            ),
          },
          {
            title: '最后更新',
            dataIndex: 'updated_at',
            // 「2026-09-24 21:19」实测约 135px + 左右内边距 16，再窄最后一位会被固定的操作列压住
            width: 156,
            render: (_, row) => (
              <span className="tabular-nums ticket-page-nowrap">
                {formatTime(row.updated_at)}
              </span>
            ),
          },
          {
            title: '操作',
            valueType: 'option',
            // 手机上两个动作都只留图标，固定列不再吃掉近一半可视宽度。
            // 注意 fixed 不能按断点切换：ProTable 首次渲染就把 fixed 记进列设置状态，之后改了也不生效
            width: screens.md ? 144 : 76,
            fixed: 'right',
            render: (_, row) => (
              <RowActions
                actions={[
                  {
                    key: 'open',
                    label: row.status === 0 ? '查看/回复' : '查看',
                    icon: <MessageOutlined />,
                    iconOnly: !screens.md,
                    onClick: () => setOpenId(row.id),
                  },
                  row.status === 0 && {
                    key: 'close',
                    label: '关闭工单',
                    icon: <CloseCircleOutlined />,
                    danger: true,
                    iconOnly: true,
                    onClick: () =>
                      Modal.confirm({
                        title: `关闭工单「${row.subject}」？`,
                        content: '关闭后用户和客服都不能再回复。',
                        okText: '确认关闭',
                        cancelText: '取消',
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await closeTicket(row.id)
                          message.success('工单已关闭')
                          reload()
                        },
                      }),
                  },
                ]}
              />
            ),
          },
        ]}
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50],
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 张工单`,
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        toolBarRender={() => [
          <Button key="refresh" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>,
        ]}
        // 桌面上其余列合计 684，主题列至少留 ~166；1180 宽的笔记本上刚好不用横向滚动
        scroll={{ x: 850 }}
        headerTitle={
          <Space size={8} wrap>
            <span>全部工单</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              固定按最后更新倒序（后端不支持排序）
            </Typography.Text>
          </Space>
        }
      />

      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        width={screens.md ? 720 : '100%'}
        destroyOnHidden
        className="ticket-page-drawer"
        title={
          detail ? (
            <div className="ticket-page-drawer-title">
              <Typography.Text strong ellipsis={{ tooltip: detail.subject }}>
                {detail.subject}
              </Typography.Text>
              <div className="ticket-page-drawer-meta">
                <StatusTag status={detail.status} />
                <Tag bordered={false} color={levelColor(detail.level)}>
                  级别 {levelLabel(detail.level)}
                </Tag>
                <span className="tabular-nums">#{detail.id}</span>
                <span className="tabular-nums">用户 #{detail.user_id}</span>
                <span className="tabular-nums">创建于 {formatTime(detail.created_at)}</span>
              </div>
            </div>
          ) : (
            '工单详情'
          )
        }
        footer={composer}
        styles={{ body: { padding: 0, background: 'var(--va-color-bg-layout)' } }}
      >
        <Spin spinning={loadingDetail}>
          <div className="ticket-page-thread-wrap">{thread}</div>
        </Spin>
      </Drawer>
    </>
  )
}
