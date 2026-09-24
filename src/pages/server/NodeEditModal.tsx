import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Tag,
  Typography,
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
import FormSection from '@/components/FormSection'
import SettingSwitch from '@/components/SettingSwitch'
import {
  COMMON_FIELDS,
  jsonFieldNames,
  PROTOCOL_COLORS,
  PROTOCOL_FIELDS,
  PROTOCOL_GROUPS,
  PROTOCOL_SHORT_LABELS,
  switchFieldNames,
  type ProtocolField,
} from './protocolSchema'
import './ServerPage.css'

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

/** JSON / 多行文本：整行宽、放在分组最后 */
function isWide(field: ProtocolField): boolean {
  return field.type === 'json' || field.type === 'textarea'
}

const GROUP_MAIN = '__main'
const GROUP_ADVANCED = '__advanced'

interface Section {
  key: string
  title: ReactNode
  description?: ReactNode
  fields: ProtocolField[]
}

/**
 * 把协议字段按「小节」排版（纯展示，不影响提交的数据）：
 *   「XX 配置」（普通字段）→ schema 里声明的额外分组 → 「高级配置」（JSON / 多行文本）
 */
function buildSections(protocol: ServerProtocol, fields: ProtocolField[]): Section[] {
  const extra = PROTOCOL_GROUPS[protocol] ?? []
  const known = new Set(extra.map((g) => g.key))
  const buckets = new Map<string, ProtocolField[]>()
  for (const f of fields) {
    const key =
      f.group && known.has(f.group) ? f.group : isWide(f) ? GROUP_ADVANCED : GROUP_MAIN
    buckets.set(key, [...(buckets.get(key) ?? []), f])
  }
  const hasJson = (buckets.get(GROUP_ADVANCED) ?? []).some((f) => f.type === 'json')
  const sections: Section[] = [
    {
      key: GROUP_MAIN,
      title: `${PROTOCOL_SHORT_LABELS[protocol]} 配置`,
      description:
        protocol === 'v2node'
          ? '统一节点类型：字段是各协议的超集，实际生效哪些取决于「协议」选项。填了不相关的字段不会报错，但也不会生效。'
          : undefined,
      fields: buckets.get(GROUP_MAIN) ?? [],
    },
    ...extra.map((g) => ({ ...g, fields: buckets.get(g.key) ?? [] })),
    {
      key: GROUP_ADVANCED,
      title: '高级配置',
      description: hasJson ? 'JSON 格式，留空表示不设置；保存前会先在本地校验语法' : undefined,
      fields: buckets.get(GROUP_ADVANCED) ?? [],
    },
  ]
  return sections.filter((s) => s.fields.length > 0)
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
  const sections = useMemo(
    () => buildSections(protocol, specificFields),
    [protocol, specificFields],
  )

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
      // 开关默认「关」：提交时本来就会把 undefined / false 都转成 0，数据不变；
      // 只是让必填的开关（如 vmess 的 tls）不碰也能通过校验，而不是报「请填写启用 TLS」
      form.setFieldsValue({
        rate: 1,
        group_id: [],
        route_id: [],
        tags: [],
        ...Object.fromEntries(switchFields.map((name) => [name, false])),
      })
    }
    // switchFields 由 protocol 决定（每次渲染都是新数组，不能放进依赖，否则会反复重置表单）
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

  function rulesFor(field: ProtocolField) {
    return field.required
      ? [{ required: true, message: `请填写${field.label}` }]
      : undefined
  }

  function renderControl(field: ProtocolField): ReactNode {
    switch (field.type) {
      case 'number':
        return (
          <InputNumber
            style={{ width: '100%' }}
            placeholder={field.placeholder}
            suffix={field.unit}
          />
        )
      case 'select':
        return (
          <Select
            style={{ width: '100%' }}
            allowClear={!field.required}
            placeholder={field.placeholder ?? '请选择'}
            options={field.options}
          />
        )
      case 'json':
        return (
          <Input.TextArea
            className="mono"
            autoSize={{ minRows: 3, maxRows: 10 }}
            spellCheck={false}
            placeholder={field.placeholder ?? '{ }'}
          />
        )
      case 'textarea':
        // 目前只有 padding_scheme 这类规则文本，等宽更好对照
        return (
          <Input.TextArea
            className="mono"
            spellCheck={false}
            autoSize={{ minRows: 3, maxRows: 10 }}
            placeholder={field.placeholder}
          />
        )
      default:
        return <Input placeholder={field.placeholder} />
    }
  }

  /** 普通字段 / JSON 字段：栅格里的一列，说明用标签旁的问号提示 */
  function renderField(field: ProtocolField) {
    const label =
      field.type === 'json' ? (
        <span className="server-page-json-label">
          {field.label}
          {/* 显示真实字段名：vmess 的 camelCase 和其它协议的 snake_case 一眼可辨 */}
          <code className="server-page-json-key">{field.name}</code>
        </span>
      ) : (
        field.label
      )
    return (
      <Col key={field.name} xs={24} md={field.span ?? (isWide(field) ? 24 : 12)}>
        <Form.Item
          name={field.name}
          label={label}
          rules={rulesFor(field)}
          tooltip={
            field.help ? <span className="server-page-help">{field.help}</span> : undefined
          }
        >
          {renderControl(field)}
        </Form.Item>
      </Col>
    )
  }

  /** 开关字段：单独成行的 SettingSwitch 卡片，同一行等高；小节里只有一个开关时占满整行 */
  function renderSwitch(field: ProtocolField, alone: boolean) {
    return (
      <Col key={field.name} xs={24} md={alone ? 24 : (field.span ?? 12)}>
        <SettingSwitch
          name={field.name}
          title={field.label}
          description={field.help}
          rules={rulesFor(field)}
        />
      </Col>
    )
  }

  /** 一个小节：普通控件一个栅格 → 开关一行 → 宽字段 */
  function renderSectionBody(fields: ProtocolField[]) {
    const inputs = fields.filter((f) => f.type !== 'switch' && !isWide(f))
    const switches = fields.filter((f) => f.type === 'switch')
    const wide = fields.filter(isWide)
    return (
      <>
        {inputs.length > 0 && <Row gutter={16}>{inputs.map(renderField)}</Row>}
        {switches.length > 0 && (
          <Row gutter={16}>{switches.map((f) => renderSwitch(f, switches.length === 1))}</Row>
        )}
        {wide.length > 0 && <Row gutter={16}>{wide.map(renderField)}</Row>}
      </>
    )
  }

  return (
    <Modal
      open={open}
      title={
        <span className="server-page-modal-title">
          <span>{isEdit ? '编辑节点' : '新增节点'}</span>
          <Tag bordered={false} color={PROTOCOL_COLORS[protocol]}>
            {PROTOCOL_SHORT_LABELS[protocol]}
          </Tag>
          {isEdit && (
            <Typography.Text type="secondary" className="server-page-modal-title-id">
              #{node!.id}
            </Typography.Text>
          )}
        </span>
      }
      onCancel={onClose}
      onOk={handleOk}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={submitting}
      width={760}
      destroyOnHidden
      maskClosable={false}
      styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
    >
      <Form<Values> form={form} layout="vertical" preserve={false}>
        <FormSection title="基础信息" first>
          <Row gutter={16}>{COMMON_FIELDS.map(renderField)}</Row>
        </FormSection>

        <FormSection
          title="权限与路由"
          description="权限组决定哪些套餐的用户能用这个节点"
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="group_id"
                label="权限组"
                rules={[{ required: true, message: '至少选择一个权限组' }]}
              >
                <Select
                  mode="multiple"
                  style={{ width: '100%' }}
                  maxTagCount="responsive"
                  placeholder="选择权限组"
                  optionFilterProp="label"
                  loading={!groups}
                  // 选项还没回来时显示「#2」而不是裸数字「2」
                  labelRender={(p) => p.label ?? `#${p.value}`}
                  options={(groups ?? []).map((g) => ({
                    value: g.id,
                    label: `${g.name} (#${g.id})`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="route_id" label="路由规则">
                <Select
                  mode="multiple"
                  allowClear
                  style={{ width: '100%' }}
                  maxTagCount="responsive"
                  placeholder="不套用规则"
                  optionFilterProp="label"
                  loading={!routes}
                  labelRender={(p) => p.label ?? `#${p.value}`}
                  options={(routes ?? []).map((r) => ({
                    value: r.id,
                    label: `${r.remarks} (#${r.id})`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="tags" label="标签" tooltip="展示给用户的节点标签，回车或逗号分隔">
                <Select
                  mode="tags"
                  style={{ width: '100%' }}
                  maxTagCount="responsive"
                  placeholder="回车添加"
                  tokenSeparators={[',']}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="parent_id"
                label="父节点 ID"
                tooltip="填了则作为子节点，共享父节点的流量统计"
              >
                <InputNumber style={{ width: '100%' }} placeholder="无（独立节点）" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        {sections.map((s) => (
          <FormSection key={s.key} title={s.title} description={s.description}>
            {renderSectionBody(s.fields)}
          </FormSection>
        ))}
      </Form>
    </Modal>
  )
}
