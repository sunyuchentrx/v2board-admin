import { useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dropServerRoute,
  fetchServerRoutes,
  ROUTE_ACTIONS,
  saveServerRoute,
  type RouteAction,
  type ServerRoute,
} from '@/api/server'

interface FormValues {
  remarks: string
  action: RouteAction
  match: string[]
  action_value?: string
}

/** match 在库里是 JSON 字符串，fetch 时后端已 json_decode，但兜底处理一下 */
function matchToArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : [value]
    } catch {
      return [value]
    }
  }
  return []
}

export default function ServerRoutePanel() {
  const qc = useQueryClient()
  const [form] = Form.useForm<FormValues>()
  const [editing, setEditing] = useState<ServerRoute | null | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const action = Form.useWatch('action', form)
  // default_out 时后端把 match 置空并跳过必填校验（required_unless）
  const matchRequired = action !== 'default_out'

  const { data: routes, isFetching } = useQuery({
    queryKey: ['server-routes'],
    queryFn: fetchServerRoutes,
  })

  const reload = () => qc.invalidateQueries({ queryKey: ['server-routes'] })

  async function handleOk() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      await saveServerRoute({
        ...(editing ? { id: editing.id } : {}),
        remarks: values.remarks,
        action: values.action,
        // default_out 不需要 match，后端也会自己置空
        ...(values.action === 'default_out'
          ? {}
          : { match: values.match ?? [] }),
        action_value: values.action_value?.trim() || null,
      })
      message.success(editing ? '已保存' : '已创建')
      reload()
      setEditing(undefined)
      form.resetFields()
    } catch {
      // 拦截器已提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Card
        title={
          <Space>
            <span>路由规则</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              节点可套用这些规则做分流 / 阻断
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields()
                form.setFieldsValue({ action: 'block' })
                setEditing(null)
              }}
            >
              新增规则
            </Button>
          </Space>
        }
      >
        <Table<ServerRoute>
          rowKey="id"
          loading={isFetching}
          dataSource={routes ?? []}
          pagination={false}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 70 },
            { title: '备注', dataIndex: 'remarks', width: 180, ellipsis: true },
            {
              title: '动作',
              dataIndex: 'action',
              width: 120,
              render: (v: string) => (
                <Tag color={v.startsWith('block') ? 'red' : 'blue'}>
                  {ROUTE_ACTIONS[v as RouteAction] ?? v}
                </Tag>
              ),
            },
            {
              title: '动作参数',
              dataIndex: 'action_value',
              width: 160,
              ellipsis: true,
              render: (v: string | null) =>
                v || <Typography.Text type="secondary">—</Typography.Text>,
            },
            {
              title: '匹配规则',
              dataIndex: 'match',
              render: (raw) => {
                const list = matchToArray(raw)
                if (list.length === 0) {
                  return <Typography.Text type="secondary">无（默认出口）</Typography.Text>
                }
                return (
                  <Space size={4} wrap>
                    {list.slice(0, 6).map((m, i) => (
                      <Tag key={i}>{m}</Tag>
                    ))}
                    {list.length > 6 && <Tag>+{list.length - 6}</Tag>}
                  </Space>
                )
              },
            },
            {
              title: '操作',
              width: 130,
              render: (_, row) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      form.setFieldsValue({
                        remarks: row.remarks,
                        action: row.action as RouteAction,
                        match: matchToArray(row.match),
                        action_value: row.action_value ?? undefined,
                      })
                      setEditing(row)
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      Modal.confirm({
                        title: `删除规则「${row.remarks}」？`,
                        content: '仍在引用这条规则的节点会自动失去该规则。',
                        okText: '确认删除',
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await dropServerRoute(row.id)
                          message.success('已删除')
                          reload()
                        },
                      })
                    }
                  />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={editing !== undefined}
        title={editing ? `编辑规则 #${editing.id}` : '新增路由规则'}
        onCancel={() => setEditing(undefined)}
        onOk={handleOk}
        confirmLoading={submitting}
        width={640}
        destroyOnClose
      >
        <Form<FormValues> form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="remarks"
            label="备注"
            rules={[{ required: true, message: '备注不能为空' }]}
          >
            <Input placeholder="例如：屏蔽 BT" />
          </Form.Item>
          <Form.Item
            name="action"
            label="动作"
            rules={[{ required: true, message: '请选择动作' }]}
          >
            <Select
              options={Object.entries(ROUTE_ACTIONS).map(([v, l]) => ({
                value: v,
                label: `${l} (${v})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="match"
            label="匹配规则"
            rules={
              matchRequired
                ? [{ required: true, message: '匹配规则不能为空' }]
                : undefined
            }
            extra={
              matchRequired
                ? '每条一个，回车添加。例如 geosite:category-ads、domain:example.com'
                : '动作为「默认出口」时不需要匹配规则，后端会自动置空'
            }
          >
            <Select
              mode="tags"
              disabled={!matchRequired}
              placeholder={matchRequired ? '回车添加' : '默认出口无需匹配'}
              tokenSeparators={[',', '\n', ' ']}
            />
          </Form.Item>
          <Form.Item
            name="action_value"
            label="动作参数"
            extra="部分动作需要，例如 dns 的服务器地址、route 的出口标签"
          >
            <Input placeholder="留空表示无参数" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
