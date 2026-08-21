import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dropPayment,
  fetchPaymentForm,
  fetchPaymentMethods,
  fetchPayments,
  savePayment,
  sortPayments,
  togglePaymentEnable,
  type AdminPayment,
} from '@/api/ops'
import { centsToYuan, formatMoney, yuanToCents } from '@/lib/format'

interface FormValues {
  name: string
  payment: string
  icon?: string
  notify_domain?: string
  handling_fee_fixed_yuan?: number
  handling_fee_percent?: number
  /**
   * 各网关自己的配置字段（键形如 cfg_xxx），由 getPaymentForm 在运行时决定，
   * 无法静态枚举 —— 用 any 是为了让 antd 的 setFieldsValue 能接受。
   */
  [key: string]: any
}

function PaymentEditModal({
  open,
  payment,
  onClose,
  onSaved,
}: {
  open: boolean
  payment: AdminPayment | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const isEdit = payment !== null
  const selected = Form.useWatch('payment', form)

  const { data: methods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: fetchPaymentMethods,
    enabled: open,
  })

  // 网关的配置字段由后端各 Payment 类的 form() 决定，选了网关才知道有哪些字段
  const { data: formDef, isFetching: loadingForm } = useQuery({
    queryKey: ['payment-form', selected, payment?.id],
    queryFn: () => fetchPaymentForm(selected!, payment?.id),
    enabled: open && !!selected,
  })

  useEffect(() => {
    if (!open) return
    if (payment) {
      form.setFieldsValue({
        name: payment.name,
        payment: payment.payment,
        icon: payment.icon ?? undefined,
        notify_domain: payment.notify_domain ?? undefined,
        handling_fee_fixed_yuan:
          payment.handling_fee_fixed === null
            ? undefined
            : centsToYuan(payment.handling_fee_fixed),
        handling_fee_percent: payment.handling_fee_percent ?? undefined,
      })
    } else {
      form.resetFields()
    }
  }, [open, payment, form])

  // 网关配置字段的当前值由 getPaymentForm 回填（PaymentService::form 会带 value）
  useEffect(() => {
    if (!formDef) return
    const values: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(formDef)) {
      values[`cfg_${key}`] = field.value ?? undefined
    }
    form.setFieldsValue(values as FormValues)
  }, [formDef, form])

  async function handleOk() {
    const values = await form.validateFields().catch(() => null)
    if (!values) return

    const config: Record<string, unknown> = {}
    for (const key of Object.keys(formDef ?? {})) {
      const v = values[`cfg_${key}`]
      if (v !== undefined && v !== '') config[key] = v
    }

    setSubmitting(true)
    try {
      await savePayment({
        ...(payment ? { id: payment.id } : {}),
        name: values.name,
        payment: values.payment,
        config,
        icon: values.icon?.trim() ? values.icon.trim() : null,
        notify_domain: values.notify_domain?.trim()
          ? values.notify_domain.trim()
          : null,
        handling_fee_fixed:
          values.handling_fee_fixed_yuan === undefined
            ? null
            : yuanToCents(values.handling_fee_fixed_yuan),
        handling_fee_percent: values.handling_fee_percent ?? null,
      })
      message.success(isEdit ? '已保存' : '已创建')
      onSaved()
      onClose()
    } catch {
      // 拦截器已提示（例如未配站点地址会 abort 500）
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isEdit ? `编辑支付方式「${payment!.name}」` : '新增支付方式'}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      width={680}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="保存前必须先在「系统配置 → 站点」里填好站点地址"
        description="后端要用站点地址拼支付回调 URL，没配会直接拒绝保存。"
      />
      <Form<FormValues> form={form} layout="vertical" preserve={false}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="显示名称"
              rules={[{ required: true, message: '请输入显示名称' }]}
              extra="用户下单时看到的名字"
            >
              <Input placeholder="例如：支付宝" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="payment"
              label="网关类型"
              rules={[{ required: true, message: '请选择网关' }]}
              extra={isEdit ? '改网关类型会导致配置字段变化' : '选项来自 app/Payments/ 下的类'}
            >
              <Select
                showSearch
                placeholder="选择网关"
                options={(methods ?? []).map((m) => ({ value: m, label: m }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="handling_fee_fixed_yuan" label="固定手续费 (元)">
              <InputNumber
                min={0}
                step={0.01}
                precision={2}
                style={{ width: '100%' }}
                placeholder="无"
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="handling_fee_percent"
              label="百分比手续费 (%)"
              rules={[
                {
                  type: 'number',
                  min: 0.1,
                  max: 100,
                  message: '后端限制 0.1 - 100',
                },
              ]}
            >
              <InputNumber
                min={0.1}
                max={100}
                step={0.1}
                style={{ width: '100%' }}
                placeholder="无"
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="icon" label="图标地址">
              <Input placeholder="可留空" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="notify_domain"
          label="自定义回调域名"
          rules={[{ type: 'url', message: '必须是合法 URL' }]}
          extra="留空则用站点地址。填了会替换回调 URL 的域名部分"
        >
          <Input placeholder="https://pay.example.com" />
        </Form.Item>

        <Typography.Title level={5}>网关配置</Typography.Title>
        <Spin spinning={loadingForm}>
          {!selected ? (
            <Typography.Text type="secondary">请先选择网关类型</Typography.Text>
          ) : (
            <Row gutter={16}>
              {Object.entries(formDef ?? {}).map(([key, field]) => (
                <Col span={12} key={key}>
                  <Form.Item
                    name={`cfg_${key}`}
                    label={field.label || key}
                    extra={field.description}
                  >
                    <Input placeholder={key} />
                  </Form.Item>
                </Col>
              ))}
            </Row>
          )}
        </Spin>
      </Form>
    </Modal>
  )
}

export default function PaymentList() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<AdminPayment | null | undefined>(undefined)

  const { data: payments, isFetching } = useQuery({
    queryKey: ['payments'],
    queryFn: fetchPayments,
  })

  const reload = () => qc.invalidateQueries({ queryKey: ['payments'] })

  const sortMutation = useMutation({
    mutationFn: sortPayments,
    onSuccess: () => {
      message.success('顺序已保存')
      reload()
    },
  })

  function move(index: number, delta: number) {
    if (!payments) return
    const next = [...payments]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const a = next[index]!
    const b = next[target]!
    next[index] = b
    next[target] = a
    sortMutation.mutate(next.map((p) => p.id))
  }

  return (
    <>
      <Card
        title={
          <Space>
            <span>支付配置</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              顺序决定用户下单时的展示次序
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
              onClick={() => setEditing(null)}
            >
              新增支付方式
            </Button>
          </Space>
        }
      >
        <Table<AdminPayment>
          rowKey="id"
          loading={isFetching || sortMutation.isPending}
          dataSource={payments ?? []}
          pagination={false}
          scroll={{ x: 1200 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 64 },
            { title: '显示名称', dataIndex: 'name', width: 140, ellipsis: true },
            {
              title: '网关',
              dataIndex: 'payment',
              width: 150,
              render: (v: string) => <Tag color="geekblue">{v}</Tag>,
            },
            {
              title: '手续费',
              width: 140,
              render: (_, row) => {
                const parts: string[] = []
                if (row.handling_fee_fixed) parts.push(formatMoney(row.handling_fee_fixed))
                if (row.handling_fee_percent) parts.push(`${row.handling_fee_percent}%`)
                return parts.length > 0 ? (
                  parts.join(' + ')
                ) : (
                  <Typography.Text type="secondary">无</Typography.Text>
                )
              },
            },
            {
              title: '回调地址',
              dataIndex: 'notify_url',
              ellipsis: true,
              render: (v: string | undefined) =>
                v ? (
                  <Typography.Text copyable={{ text: v }} style={{ fontSize: 12 }}>
                    {v}
                  </Typography.Text>
                ) : (
                  '—'
                ),
            },
            {
              title: '启用',
              dataIndex: 'enable',
              width: 70,
              render: (_, row) => (
                <Switch
                  size="small"
                  checked={row.enable === 1}
                  onChange={async () => {
                    // 后端是取反
                    await togglePaymentEnable(row.id)
                    message.success('已更新')
                    reload()
                  }}
                />
              ),
            },
            {
              title: '操作',
              width: 170,
              fixed: 'right',
              render: (_, row, index) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={index === (payments?.length ?? 0) - 1}
                    onClick={() => move(index, 1)}
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setEditing(row)}
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
                        title: `删除支付方式「${row.name}」？`,
                        content:
                          '已用这个方式下过的订单不会受影响，但它们的回调若在删除后到达会因为找不到配置而被拒。',
                        okText: '确认删除',
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await dropPayment(row.id)
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

      <PaymentEditModal
        open={editing !== undefined}
        payment={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={reload}
      />
    </>
  )
}
