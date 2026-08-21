import { useEffect, useState } from 'react'
import {
  Alert,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Switch,
  message,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import {
  fetchServerGroups,
  fetchServerRoutes,
  saveNode,
  type ServerNode,
  type ServerProtocol,
} from '@/api/server'
import {
  COMMON_FIELDS,
  jsonFieldNames,
  PROTOCOL_FIELDS,
  PROTOCOL_LABELS,
  switchFieldNames,
  type ProtocolField,
} from './protocolSchema'

interface Props {
  open: boolean
  protocol: ServerProtocol
  /** null = 新增 */
  node: ServerNode | null
  onClose: () => void
  onSaved: () => void
}

/**
 * 表单值。用 `any` 的索引签名是因为字段集由 schema 在运行时决定，
 * 无法静态枚举；antd 的 setFieldsValue 也不接受 `unknown` 索引签名。
 * 类型安全靠 protocolSchema.ts 里的字段定义与后端校验规则保证。
 */
type Values = Record<string, any>

/** JSON 字段：库里存字符串，表单里编辑字符串，提交时解析成对象 */
function stringifyJson(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function NodeEditModal({
  open,
  protocol,
  node,
  onClose,
  onSaved,
}: Props) {
  const [form] = Form.useForm<Values>()
  const [submitting, setSubmitting] = useState(false)
  const isEdit = node !== null

  const { data: groups } = useQuery({
    queryKey: ['server-groups'],
    queryFn: fetchServerGroups,
    enabled: open,
  })
  const { data: routes } = useQuery({
    queryKey: ['server-routes'],
    queryFn: fetchServerRoutes,
    enabled: open,
  })

  const specificFields = PROTOCOL_FIELDS[protocol]
  const jsonFields = jsonFieldNames(protocol)
  const switchFields = switchFieldNames(protocol)

  useEffect(() => {
    if (!open) return
    if (node) {
      const values: Values = {
        name: node.name,
        rate: Number(node.rate),
        host: node.host,
        port: String(node.port),
        server_port: node.server_port,
        group_id: node.group_id ?? [],
        route_id: node.route_id ?? [],
        tags: node.tags ?? [],
        parent_id: node.parent_id,
      }
      for (const field of specificFields) {
        const raw = node[field.name]
        if (field.type === 'json') {
          values[field.name] = stringifyJson(raw)
        } else if (field.type === 'switch') {
          values[field.name] = raw === 1 || raw === true
        } else {
          values[field.name] = raw ?? undefined
        }
      }
      form.setFieldsValue(values)
    } else {
      form.resetFields()
      form.setFieldsValue({ rate: 1, group_id: [], route_id: [], tags: [] })
    }
  }, [open, node, protocol, specificFields, form])

  async function handleOk() {
    let values: Values
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    // JSON 字段先在前端解析，语法错误当场报在表单上，
    // 而不是发出去等后端一个笼统的 500
    const payload: Values = { ...values }
    for (const name of jsonFields) {
      const raw = payload[name]
      if (typeof raw === 'string' && raw.trim() !== '') {
        try {
          payload[name] = JSON.parse(raw)
        } catch {
          form.setFields([{ name, errors: ['不是合法的 JSON'] }])
          return
        }
      } else {
        payload[name] = null
      }
    }
    // 后端各协议的校验规则里布尔字段是 in:0,1，传 true/false 会 422
    for (const name of switchFields) {
      payload[name] = payload[name] ? 1 : 0
    }

    setSubmitting(true)
    try {
      await saveNode(protocol, {
        ...payload,
        ...(node ? { id: node.id } : {}),
      } as Parameters<typeof saveNode>[1])
      message.success(isEdit ? '节点已保存' : '节点已创建')
      onSaved()
      onClose()
    } catch {
      // 拦截器已提示
    } finally {
      setSubmitting(false)
    }
  }

  function renderField(field: ProtocolField) {
    const rules = field.required
      ? [{ required: true, message: `请填写${field.label}` }]
      : undefined

    let control: React.ReactNode
    switch (field.type) {
      case 'number':
        control = (
          <InputNumber style={{ width: '100%' }} placeholder={field.placeholder} />
        )
        break
      case 'switch':
        control = <Switch />
        break
      case 'select':
        control = (
          <Select
            allowClear={!field.required}
            placeholder={field.placeholder ?? '请选择'}
            options={field.options}
          />
        )
        break
      case 'json':
        control = (
          <Input.TextArea
            rows={4}
            placeholder={field.placeholder ?? '{ }'}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        )
        break
      case 'textarea':
        control = <Input.TextArea rows={3} placeholder={field.placeholder} />
        break
      default:
        control = <Input placeholder={field.placeholder} />
    }

    return (
      <Col span={field.span ?? 12} key={field.name}>
        <Form.Item
          name={field.name}
          label={field.label}
          rules={rules}
          extra={field.help}
          valuePropName={field.type === 'switch' ? 'checked' : undefined}
        >
          {control}
        </Form.Item>
      </Col>
    )
  }

  return (
    <Modal
      open={open}
      title={
        isEdit
          ? `编辑 ${PROTOCOL_LABELS[protocol]} 节点 #${node!.id}`
          : `新增 ${PROTOCOL_LABELS[protocol]} 节点`
      }
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      width={860}
      destroyOnClose
      maskClosable={false}
    >
      <Form<Values> form={form} layout="vertical" preserve={false}>
        <Divider orientation="left" plain>
          基础
        </Divider>
        <Row gutter={16}>{COMMON_FIELDS.map(renderField)}</Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="group_id"
              label="权限组"
              rules={[{ required: true, message: '至少选择一个权限组' }]}
              extra="决定哪些套餐的用户能用这个节点"
            >
              <Select
                mode="multiple"
                placeholder="选择权限组"
                options={(groups ?? []).map((g) => ({
                  value: g.id,
                  label: `${g.name} (#${g.id})`,
                }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="route_id" label="路由规则">
              <Select
                mode="multiple"
                allowClear
                placeholder="不套用规则"
                options={(routes ?? []).map((r) => ({
                  value: r.id,
                  label: `${r.remarks} (#${r.id})`,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="tags" label="标签">
              <Select mode="tags" placeholder="回车添加" tokenSeparators={[',']} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="parent_id"
              label="父节点 ID"
              extra="填了则作为子节点，共享父节点的流量统计"
            >
              <InputNumber style={{ width: '100%' }} placeholder="无" />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>
          {PROTOCOL_LABELS[protocol]} 专有配置
        </Divider>
        {protocol === 'v2node' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="v2node 是统一节点类型"
            description="字段是各协议的超集，实际生效哪些取决于上面的「协议」选项。填不相关的字段不会报错，但也不会生效。"
          />
        )}
        <Row gutter={16}>{specificFields.map(renderField)}</Row>
      </Form>
    </Modal>
  )
}
