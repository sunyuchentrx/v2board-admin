import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Form,
  Grid,
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
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  ApiOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  CreditCardOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  LinkOutlined,
  PictureOutlined,
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
  type PaymentFormField,
} from '@/api/ops'
import FormSection from '@/components/FormSection'
import RowActions from '@/components/RowActions'
import { centsToYuan, formatMoney, yuanToCents } from '@/lib/format'
import './PaymentList.css'

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

/**
 * 看起来像密钥的网关字段，用密码框遮住，防共享屏幕 / 录屏 / 截图时泄露。
 * 各 Payment 类的 form() 把这些字段一律标成 type 'input'，只能按键名和标签猜：
 *   stripe_sk_live、stripe_webhook_key、EPay/Paytaro 的 key、AlipayF2F 的 private_key、
 *   *_api_key、*_webhook_key、coinpayments_ipn_secret、epusdt_token、bepusdt_apitoken …
 * 公钥（AlipayF2F 的 public_key）不是机密，排除掉，免得核对时还得点开看。
 * 注意这只是界面遮挡：getPaymentForm 的响应里仍然是明文。
 */
const SECRET_FIELD_RE = /key|secret|sk_|private|token|password|签名|密钥|私钥/i
const PUBLIC_FIELD_RE = /public|公钥/i

function isSecretField(key: string, field: PaymentFormField): boolean {
  const text = `${key} ${field.label ?? ''}`
  return SECRET_FIELD_RE.test(text) && !PUBLIC_FIELD_RE.test(text)
}

/** 列表里的空值 */
const Muted = ({ children = '—' }: { children?: ReactNode }) => (
  <Typography.Text type="secondary">{children}</Typography.Text>
)

/** 回调地址里的「协议 + 域名」部分（notify_url = notify_domain + 固定路径），仅用于展示 */
function notifyHost(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(url)
  return m ? m[0] : ''
}

/** 列表里显示的域名：https:// 省掉（完整地址在 tooltip 和复制里），http:// 保留好让人注意到 */
function notifyHostLabel(url: string): string {
  return notifyHost(url).replace(/^https:\/\//i, '')
}

/** 回调地址的最后一段（即 uuid），列表里做「域名 /…/ uuid」的中间省略，仅用于展示 */
function notifyTail(url: string): string {
  const path = url.slice(notifyHost(url).length).replace(/\/+$/, '')
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * 后端 decimal 列（handling_fee_percent）按字符串返回，例如 "3.50"。
 * 原样塞进表单的话 InputNumber 能显示，但字段值仍是字符串，rules 里的 type:'number'
 * 校验不过 —— 不改任何东西直接点保存也会报「后端限制 0.1 - 100」，弹窗关不掉。
 */
function toNumberOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** 已保存的支付方式 → 表单值（金额分 → 元） */
function toFormValues(payment: AdminPayment): Partial<FormValues> {
  return {
    name: payment.name,
    payment: payment.payment,
    icon: payment.icon ?? undefined,
    notify_domain: payment.notify_domain ?? undefined,
    handling_fee_fixed_yuan:
      payment.handling_fee_fixed === null
        ? undefined
        : centsToYuan(payment.handling_fee_fixed),
    handling_fee_percent: toNumberOrUndefined(payment.handling_fee_percent),
  }
}

/** getPaymentForm 的字段定义 → cfg_xxx 表单值 */
function toConfigValues(formDef: Record<string, PaymentFormField> | undefined) {
  const values: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(formDef ?? {})) {
    values[`cfg_${key}`] = field.value ?? undefined
  }
  return values
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

  /**
   * 同一份回填值也作为 Form 的 initialValues。
   * Form 是 preserve={false}：字段卸载时会被重置成 initialValue。开发模式的 StrictMode
   * 会把新挂载的字段「卸载再挂载」一次，只靠下面 effect 里的 setFieldsValue 的话，
   * 值刚写进去就被清空（编辑弹窗打开是空的、网关配置也是空的）。生产环境不受影响，两者一致。
   */
  const initialValues = useMemo<Partial<FormValues>>(
    () => ({
      ...(payment ? toFormValues(payment) : {}),
      ...toConfigValues(formDef),
    }),
    [payment, formDef],
  )

  useEffect(() => {
    if (!open) return
    if (payment) {
      form.setFieldsValue(toFormValues(payment))
    } else {
      form.resetFields()
    }
  }, [open, payment, form])

  // 网关配置字段的当前值由 getPaymentForm 回填（PaymentService::form 会带 value）
  useEffect(() => {
    if (!formDef) return
    form.setFieldsValue(toConfigValues(formDef) as FormValues)
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
        // 必填（后端 required|url），表单规则已保证非空
        notify_domain: (values.notify_domain ?? '').trim(),
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

  const configEntries = Object.entries(formDef ?? {})
  const hasSecret = configEntries.some(([key, field]) => isSecretField(key, field))

  function renderConfig() {
    if (!selected) {
      return (
        <div className="payment-config-empty">
          <ApiOutlined />
          <span>请先选择网关类型</span>
        </div>
      )
    }
    if (!formDef) {
      // 首次加载该网关的字段定义：占位高度，免得弹窗跳动
      return <div className="payment-config-empty is-loading" />
    }
    if (configEntries.length === 0) {
      return (
        <div className="payment-config-empty">
          <CheckCircleOutlined />
          <span>该网关没有需要配置的字段</span>
        </div>
      )
    }
    return (
      <Row gutter={16}>
        {configEntries.map(([key, field]) => (
          <Col xs={24} md={12} key={key}>
            <Form.Item
              name={`cfg_${key}`}
              label={field.label || key}
              tooltip={field.description || undefined}
            >
              {isSecretField(key, field) ? (
                // new-password 而不是 off：Chrome 对密码框基本无视 autoComplete="off"，
                // 新增网关时会把管理员保存的后台登录密码自动填进来并被当成密钥保存
                <Input.Password placeholder={key} autoComplete="new-password" />
              ) : (
                <Input placeholder={key} autoComplete="off" />
              )}
            </Form.Item>
          </Col>
        ))}
      </Row>
    )
  }

  return (
    <Modal
      open={open}
      title={
        isEdit ? (
          <span className="payment-modal-title">
            {`编辑支付方式「${payment!.name}」`}
            <Typography.Text type="secondary" className="payment-modal-id">
              #{payment!.id}
            </Typography.Text>
          </span>
        ) : (
          '新增支付方式'
        )
      }
      onCancel={onClose}
      onOk={handleOk}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={submitting}
      width={760}
      centered
      maskClosable={false}
      destroyOnHidden
      styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
    >
      {/* 回调 URL 只用「支付回调域名」拼这句，放到下面「支付回调」小节的说明里 */}
      <Alert
        type="info"
        showIcon
        className="payment-modal-alert"
        message="保存前必须先在「系统配置 → 站点」里填好站点地址，否则后端会直接拒绝保存"
      />
      <Form<FormValues>
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={initialValues}
      >
        <FormSection title="基本信息" first>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="显示名称"
                rules={[{ required: true, message: '请输入显示名称' }]}
                tooltip="用户下单时看到的名字"
              >
                <Input placeholder="例如：支付宝" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="payment"
                label="网关类型"
                rules={[{ required: true, message: '请选择网关' }]}
                tooltip={isEdit ? '改网关类型会导致配置字段变化' : '选项来自 app/Payments/ 下的类'}
              >
                <Select
                  className="payment-gateway-select"
                  showSearch
                  placeholder="选择网关"
                  style={{ width: '100%' }}
                  options={(methods ?? []).map((m) => ({ value: m, label: m }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="icon" label="图标地址">
            <Input
              placeholder="图片 URL，可留空"
              autoComplete="off"
              prefix={<PictureOutlined className="muted" />}
            />
          </Form.Item>
        </FormSection>

        <FormSection
          title="网关配置"
          description={
            selected
              ? `「${selected}」的配置项，字段由后端网关类定义${hasSecret ? '；密钥类字段已遮挡显示' : ''}`
              : '选择网关类型后显示对应的配置项'
          }
        >
          <Spin spinning={loadingForm}>{renderConfig()}</Spin>
        </FormSection>

        <FormSection
          title="支付回调"
          description={
            // 原来是 Form.Item 的 extra：校验出错时 antd 用负 margin 抵掉 item 的下边距，
            // extra 会贴住下一小节的分隔线，所以挪到小节说明里（文案不变）
            <>
              必填。支付回调 URL 只用这个域名拼：该域名 +{' '}
              <span className="payment-notify-path">/api/v1/guest/payment/notify/网关/uuid</span>
              ，须是支付网关能从公网访问、并能转发到后端的域名，不能填后端源站地址
            </>
          }
        >
          {/* 后端 PaymentController::save 是 required|url，且回调 URL 不会回退到站点地址 */}
          <Form.Item
            name="notify_domain"
            label="支付回调域名"
            className="payment-notify-item"
            rules={[
              { required: true, whitespace: true, message: '请填写支付回调域名' },
              { type: 'url', message: '必须是合法 URL，例如 https://pay.example.com' },
            ]}
          >
            <Input
              placeholder="https://pay.example.com"
              autoComplete="off"
              prefix={<LinkOutlined className="muted" />}
            />
          </Form.Item>
        </FormSection>

        <FormSection title="手续费" description="向用户额外收取，两项可同时设置；留空表示不收取">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="handling_fee_fixed_yuan" label="固定手续费">
                <InputNumber
                  min={0}
                  step={0.01}
                  precision={2}
                  prefix="¥"
                  style={{ width: '100%' }}
                  placeholder="不收取"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="handling_fee_percent"
                label="百分比手续费"
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
                  // 数据库是两位小数（列表里显示 3.50%），弹窗里也显示两位
                  precision={2}
                  suffix="%"
                  style={{ width: '100%' }}
                  placeholder="不收取"
                />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>
      </Form>
    </Modal>
  )
}

export default function PaymentList() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<AdminPayment | null | undefined>(undefined)
  /** 正在切换启用状态的网关 id */
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<number>>(() => new Set())

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

  async function toggleEnable(row: AdminPayment) {
    // 后端是取反（PaymentController::show），不接受目标值：连点两次就等于没改。
    // 所以请求发出到列表刷新回来之前，这一行的开关保持 loading（antd 会顺带禁用）
    if (togglingIds.has(row.id)) return
    setTogglingIds((s) => new Set(s).add(row.id))
    try {
      await togglePaymentEnable(row.id)
      message.success(row.enable === 1 ? '已停用' : '已启用')
    } catch {
      // 拦截器已提示。超时的话后端可能已经取反了，下面刷新看真实状态，别直接再点
    } finally {
      await reload()
      setTogglingIds((s) => {
        const n = new Set(s)
        n.delete(row.id)
        return n
      })
    }
  }

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

  const total = payments?.length ?? 0
  // 手机（< 576px）：刷新只留图标、操作列只留图标且不固定，免得把名称列压没
  const screens = Grid.useBreakpoint()
  const narrow = screens.sm === false

  return (
    <>
      <Card
        className="payment-card"
        title={
          <span className="payment-card-title">
            <span className="payment-card-name">全部支付方式</span>
            <Typography.Text type="secondary" className="payment-card-desc">
              {payments ? `共 ${total} 个 · ` : ''}顺序决定用户下单时的展示次序
            </Typography.Text>
          </span>
        }
        extra={
          <Space size={8}>
            <Button icon={<ReloadOutlined />} onClick={reload} aria-label="刷新">
              {narrow ? null : '刷新'}
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
          // 手机上操作列不固定时 antd 会退回 auto 布局，名称列会被不换行的长名称撑宽；固定布局才按 width 走
          tableLayout="fixed"
          scroll={{ x: 1080 }}
          rowClassName={(row) => (row.enable === 1 ? '' : 'payment-row-off')}
          columns={[
            {
              title: '排序',
              key: 'sort',
              width: 84,
              render: (_, _row, index) => (
                <span className="payment-sort">
                  <Tooltip title="上移" mouseEnterDelay={0.4}>
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowUpOutlined />}
                      aria-label="上移"
                      disabled={index === 0 || sortMutation.isPending}
                      onClick={() => move(index, -1)}
                    />
                  </Tooltip>
                  <span className="payment-sort-sep" />
                  <Tooltip title="下移" mouseEnterDelay={0.4}>
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowDownOutlined />}
                      aria-label="下移"
                      disabled={index === total - 1 || sortMutation.isPending}
                      onClick={() => move(index, 1)}
                    />
                  </Tooltip>
                </span>
              ),
            },
            {
              title: 'ID',
              dataIndex: 'id',
              width: 64,
              responsive: ['sm'],
              render: (v: number) => <Muted>{v}</Muted>,
            },
            {
              title: '显示名称',
              dataIndex: 'name',
              width: narrow ? 170 : 230,
              render: (_, row) => (
                <div className="payment-name-cell">
                  <Avatar
                    shape="square"
                    size={32}
                    className="payment-avatar"
                    src={row.icon || undefined}
                    icon={<CreditCardOutlined />}
                  />
                  <div className="payment-name-text">
                    <Typography.Text
                      className="payment-name-main"
                      ellipsis={{ tooltip: { title: row.name, placement: 'topLeft' } }}
                    >
                      {row.name}
                    </Typography.Text>
                    <Tooltip
                      title="UUID，即回调地址的最后一段"
                      placement="bottomLeft"
                      mouseEnterDelay={0.6}
                    >
                      <span className="payment-name-sub">{row.uuid}</span>
                    </Tooltip>
                  </div>
                </div>
              ),
            },
            {
              title: '网关',
              dataIndex: 'payment',
              width: 136,
              render: (v: string) => (
                <Tag bordered={false} className="payment-gateway-tag">
                  {v}
                </Tag>
              ),
            },
            {
              title: '手续费',
              key: 'fee',
              width: 132,
              align: 'right',
              render: (_, row) => {
                const percent = toNumberOrUndefined(row.handling_fee_percent)
                const parts: string[] = []
                if (row.handling_fee_fixed) parts.push(formatMoney(row.handling_fee_fixed))
                if (percent) parts.push(`${percent.toFixed(2)}%`)
                if (parts.length === 0) return <Muted />
                return (
                  <span className="tabular-nums payment-fee">
                    {parts.map((p, i) => (
                      <span key={p}>
                        {i > 0 && <span className="payment-fee-plus"> + </span>}
                        {p}
                      </span>
                    ))}
                  </span>
                )
              },
            },
            {
              title: '回调地址',
              dataIndex: 'notify_url',
              render: (v: string | null | undefined) =>
                v ? (
                  <span className="payment-notify-cell">
                    {/* 完整地址的 tooltip 和复制按钮分成两个触发区，免得两个提示叠在一起 */}
                    <Tooltip
                      title={<span className="payment-notify-tip">{v}</span>}
                      rootClassName="payment-notify-tooltip"
                      placement="topLeft"
                      mouseEnterDelay={0.3}
                    >
                      {notifyHost(v) && notifyTail(v) ? (
                        // 中间省略：「域名 /…/ uuid」。路径部分是固定格式，淡显；域名才是管理员配的，突出显示
                        <span className="mono payment-notify">
                          <span className="payment-notify-host">{notifyHostLabel(v)}</span>
                          <span className="payment-notify-tail">/…/{notifyTail(v)}</span>
                        </span>
                      ) : (
                        <span className="mono payment-notify">
                          <span className="payment-notify-host">{v}</span>
                        </span>
                      )}
                    </Tooltip>
                    <Typography.Text
                      className="payment-notify-copy"
                      copyable={{ text: v, tooltips: ['复制回调地址', '已复制'] }}
                    />
                  </span>
                ) : (
                  // notify_domain 为空的旧数据：后端不回退站点地址，用户用它下单会直接报错
                  <Tag
                    bordered={false}
                    color="error"
                    icon={<ExclamationCircleOutlined />}
                    className="payment-notify-missing"
                  >
                    未配置回调域名，用户下单会失败
                  </Tag>
                ),
            },
            {
              title: '启用',
              dataIndex: 'enable',
              width: 72,
              align: 'center',
              render: (_, row) => (
                <Switch
                  size="small"
                  checked={row.enable === 1}
                  loading={togglingIds.has(row.id)}
                  onChange={() => void toggleEnable(row)}
                />
              ),
            },
            {
              title: '操作',
              key: 'actions',
              // 手机上不固定：固定列会把名称列压到只剩一小截；横向滑动时名称完整可见
              width: narrow ? 80 : 108,
              fixed: narrow ? undefined : 'right',
              render: (_, row) => (
                <RowActions
                  actions={[
                    {
                      key: 'edit',
                      label: '编辑',
                      icon: <EditOutlined />,
                      iconOnly: narrow,
                      onClick: () => setEditing(row),
                    },
                    {
                      key: 'delete',
                      label: '删除',
                      icon: <DeleteOutlined />,
                      danger: true,
                      iconOnly: true,
                      onClick: () =>
                        Modal.confirm({
                          title: `删除支付方式「${row.name}」？`,
                          content:
                            '已用这个方式下过的订单不会受影响，但它们的回调若在删除后到达会因为找不到配置而被拒。',
                          okText: '确认删除',
                          cancelText: '取消',
                          okButtonProps: { danger: true },
                          onOk: async () => {
                            await dropPayment(row.id)
                            message.success('已删除')
                            reload()
                          },
                        }),
                    },
                  ]}
                />
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
