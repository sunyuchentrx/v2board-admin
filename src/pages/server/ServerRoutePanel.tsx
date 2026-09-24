import { useState } from 'react'
import {
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import ProTable, { type ProColumns } from '@ant-design/pro-table'
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
import RowActions from '@/components/RowActions'
import './ServerPage.css'

/** 动作标签色：阻断类红、协议嗅探（也是阻断）橙、分流蓝、DNS 紫、默认出口灰 */
const ACTION_COLORS: Record<string, string> = {
  block: 'error',
  block_ip: 'error',
  block_port: 'error',
  protocol: 'warning',
  dns: 'purple',
  route: 'processing',
  route_ip: 'processing',
  default_out: 'default',
}

/** 匹配规则列最多直接显示几条，其余收成 +N（整格悬停可看全部） */
const MATCH_SHOWN = 3

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
  /**
   * 弹窗表单的初始值。不能在打开前调 form.setFieldsValue：弹窗 destroyOnHidden +
   * preserve={false}，表单挂载时 rc-field-form 会把上次卸载的字段重置成 initialValues，
   * 提前塞进去的值会被冲掉（开发模式 StrictMode 下连第一次打开都是空的）。
   */
  const [initial, setInitial] = useState<Partial<FormValues>>({})
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

  const columns: ProColumns<ServerRoute>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 64,
      render: (_, row) => <span className="tabular-nums">{row.id}</span>,
    },
    {
      title: '备注',
      dataIndex: 'remarks',
      width: 220,
      ellipsis: true,
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 110,
      render: (_, row) => (
        <Tag bordered={false} color={ACTION_COLORS[row.action] ?? 'default'}>
          {ROUTE_ACTIONS[row.action as RouteAction] ?? row.action}
        </Tag>
      ),
    },
    {
      title: '动作参数',
      dataIndex: 'action_value',
      width: 160,
      ellipsis: true,
      render: (_, row) =>
        row.action_value ? (
          <span className="mono">{row.action_value}</span>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '匹配规则',
      dataIndex: 'match',
      render: (_, row) => {
        const list = matchToArray(row.match)
        if (list.length === 0) {
          return <Typography.Text type="secondary">无（默认出口）</Typography.Text>
        }
        const rest = list.slice(MATCH_SHOWN)
        // 永远单行：列窄时标签自己缩成省略号，完整列表看悬停提示
        const cell = (
          <span className="server-page-match">
            {list.slice(0, MATCH_SHOWN).map((m, i) => (
              <Tag key={i} bordered={false}>
                {m}
              </Tag>
            ))}
            {rest.length > 0 && (
              <Tag bordered={false} className="server-page-match-more">
                +{rest.length}
              </Tag>
            )}
          </span>
        )
        return (
          <Tooltip
            mouseEnterDelay={0.3}
            title={<span className="server-page-help mono">{list.join('\n')}</span>}
          >
            {cell}
          </Tooltip>
        )
      },
    },
    {
      title: '操作',
      key: 'option',
      valueType: 'option',
      width: 116,
      fixed: 'right',
      render: (_, row) => (
        <RowActions
          actions={[
            {
              key: 'edit',
              label: '编辑',
              icon: <EditOutlined />,
              onClick: () => {
                setInitial({
                  remarks: row.remarks,
                  action: row.action as RouteAction,
                  match: matchToArray(row.match),
                  action_value: row.action_value ?? undefined,
                })
                setEditing(row)
              },
            },
            {
              key: 'delete',
              label: '删除',
              icon: <DeleteOutlined />,
              danger: true,
              iconOnly: true,
              onClick: () =>
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
                }),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <>
      <ProTable<ServerRoute>
        rowKey="id"
        loading={isFetching}
        dataSource={routes ?? []}
        columns={columns}
        search={false}
        pagination={false}
        scroll={{ x: 900 }}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        headerTitle={
          <span className="server-page-title">
            <span>全部规则</span>
            <Typography.Text type="secondary" className="server-page-title-sub">
              节点可套用这些规则做分流 / 阻断
            </Typography.Text>
          </span>
        }
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>,
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setInitial({ action: 'block' })
              setEditing(null)
            }}
          >
            新增规则
          </Button>,
        ]}
      />

      <Modal
        open={editing !== undefined}
        title={editing ? `编辑规则 #${editing.id}` : '新增路由规则'}
        onCancel={() => setEditing(undefined)}
        onOk={handleOk}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={submitting}
        width={640}
        destroyOnHidden
        maskClosable={false}
      >
        <Form<FormValues>
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={initial}
        >
          <Form.Item
            name="remarks"
            label="备注"
            rules={[{ required: true, message: '备注不能为空' }]}
          >
            <Input placeholder="例如：屏蔽 BT" />
          </Form.Item>
          {/* 动作和动作参数强相关（dns 填服务器、route 填出口标签），放同一行；顺序和列表列一致 */}
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="action"
                label="动作"
                rules={[{ required: true, message: '请选择动作' }]}
              >
                <Select
                  style={{ width: '100%' }}
                  options={Object.entries(ROUTE_ACTIONS).map(([v, l]) => ({
                    value: v,
                    label: `${l} (${v})`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="action_value"
                label="动作参数"
                tooltip="部分动作需要，例如 dns 的服务器地址、route 的出口标签"
              >
                <Input placeholder="留空表示无参数" />
              </Form.Item>
            </Col>
          </Row>
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
              className="server-page-mono-select"
              style={{ width: '100%' }}
              disabled={!matchRequired}
              placeholder={matchRequired ? '回车添加' : '默认出口无需匹配'}
              tokenSeparators={[',', '\n', ' ']}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
