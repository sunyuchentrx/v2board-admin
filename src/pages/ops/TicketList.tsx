import { useRef, useState } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
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
  MessageOutlined,
  ReloadOutlined,
  SendOutlined,
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

export default function TicketList() {
  const qc = useQueryClient()
  const tableRef = useRef<ActionType>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [replyForm] = Form.useForm<{ message: string }>()
  const [replying, setReplying] = useState(false)
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

  async function submitReply() {
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
  }

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={8}>
          <Select<0 | 1>
            style={{ width: 130 }}
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
            style={{ width: 160 }}
            allowClear
            mode="multiple"
            placeholder="回复状态"
            value={replyStatus}
            onChange={setReplyStatus}
            options={Object.entries(TICKET_REPLY_STATUS).map(([v, l]) => ({
              value: Number(v),
              label: l,
            }))}
          />
          <Input
            style={{ width: 220 }}
            allowClear
            placeholder="用户邮箱（需完整匹配）"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onPressEnter={reload}
          />
          <Button type="primary" onClick={reload}>
            查询
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setStatus(undefined)
              setReplyStatus(undefined)
              setEmail('')
              setTimeout(reload, 0)
            }}
          >
            重置
          </Button>
        </Space>
      </Card>

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
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: '主题', dataIndex: 'subject', ellipsis: true },
          {
            title: '用户',
            dataIndex: 'user_id',
            width: 90,
            // 注意 ProTable 的 render 首参是已渲染的 dom，不是字段值（和 antd Table 不同）
            render: (_, row) => `#${row.user_id}`,
          },
          {
            title: '级别',
            dataIndex: 'level',
            width: 80,
            render: (_, row) => (
              <Tag
                color={
                  row.level === 2 ? 'red' : row.level === 1 ? 'orange' : 'default'
                }
              >
                {TICKET_LEVELS[row.level as keyof typeof TICKET_LEVELS] ?? row.level}
              </Tag>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (_, row) => (
              <Tag color={row.status === 0 ? 'processing' : 'default'}>
                {TICKET_STATUS[row.status as keyof typeof TICKET_STATUS] ?? row.status}
              </Tag>
            ),
          },
          {
            title: '回复',
            dataIndex: 'reply_status',
            width: 90,
            render: (_, row) => (
              <Tag color={row.reply_status === 0 ? 'error' : 'success'}>
                {TICKET_REPLY_STATUS[
                  row.reply_status as keyof typeof TICKET_REPLY_STATUS
                ] ?? row.reply_status}
              </Tag>
            ),
          },
          {
            title: '最后更新',
            dataIndex: 'updated_at',
            width: 150,
            render: (_, row) => formatTime(row.updated_at),
          },
          {
            title: '操作',
            valueType: 'option',
            width: 150,
            fixed: 'right',
            render: (_, row) => [
              <Button
                key="open"
                type="link"
                size="small"
                icon={<MessageOutlined />}
                onClick={() => setOpenId(row.id)}
              >
                查看/回复
              </Button>,
              ...(row.status === 0
                ? [
                    <Button
                      key="close"
                      type="link"
                      size="small"
                      danger
                      icon={<CloseCircleOutlined />}
                      onClick={() =>
                        Modal.confirm({
                          title: `关闭工单「${row.subject}」？`,
                          content: '关闭后用户和客服都不能再回复。',
                          okText: '确认关闭',
                          okButtonProps: { danger: true },
                          onOk: async () => {
                            await closeTicket(row.id)
                            message.success('工单已关闭')
                            reload()
                          },
                        })
                      }
                    />,
                  ]
                : []),
            ],
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
        scroll={{ x: 1150 }}
        headerTitle={
          <Space>
            <span>工单管理</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              固定按最后更新倒序（后端不支持排序）
            </Typography.Text>
          </Space>
        }
      />

      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        width={720}
        title={detail ? `#${detail.id} ${detail.subject}` : '工单详情'}
        destroyOnClose
      >
        <Spin spinning={loadingDetail}>
          {detail ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space size={8}>
                <Tag>用户 #{detail.user_id}</Tag>
                <Tag color={detail.status === 0 ? 'processing' : 'default'}>
                  {TICKET_STATUS[detail.status as keyof typeof TICKET_STATUS]}
                </Tag>
                <Tag color={detail.level === 2 ? 'red' : 'default'}>
                  级别 {TICKET_LEVELS[detail.level as keyof typeof TICKET_LEVELS]}
                </Tag>
              </Space>

              <div
                style={{
                  maxHeight: 420,
                  overflowY: 'auto',
                  background: '#fafafa',
                  padding: 12,
                  borderRadius: 6,
                }}
              >
                {detail.message.length === 0 ? (
                  <Empty description="暂无消息" />
                ) : (
                  detail.message.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        // is_me = 发信人不是工单创建者，即客服/管理员
                        justifyContent: m.is_me ? 'flex-end' : 'flex-start',
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '76%',
                          background: m.is_me ? '#e6f4ff' : '#ffffff',
                          border: '1px solid #f0f0f0',
                          borderRadius: 6,
                          padding: '8px 10px',
                        }}
                      >
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 11, display: 'block', marginBottom: 4 }}
                        >
                          {m.is_me ? '客服' : '用户'} · {formatTime(m.created_at)}
                        </Typography.Text>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.message}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {detail.status === 0 ? (
                <Form form={replyForm} layout="vertical">
                  <Form.Item
                    name="message"
                    label="回复内容"
                    rules={[{ required: true, message: '回复不能为空' }]}
                  >
                    <Input.TextArea rows={4} placeholder="输入回复内容" />
                  </Form.Item>
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    loading={replying}
                    onClick={submitReply}
                  >
                    发送回复
                  </Button>
                </Form>
              ) : (
                <Typography.Text type="secondary">
                  工单已关闭，不能再回复。
                </Typography.Text>
              )}
            </Space>
          ) : (
            !loadingDetail && <Empty description="工单不存在" />
          )}
        </Spin>
      </Drawer>
    </>
  )
}
