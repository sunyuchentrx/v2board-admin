import { useState } from 'react'
import {
  Alert,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  message,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import {
  RESET_TRAFFIC_METHODS,
  savePlan,
  type AdminPlan,
} from '@/api/plan'
import { fetchUsers } from '@/api/user'
import FormSection from '@/components/FormSection'
import SettingSwitch from '@/components/SettingSwitch'
import { centsToYuan, yuanToCents } from '@/lib/format'
import './PlanPage.css'

/** 价格字段：后端存分，表单收元 */
const PRICE_FIELDS = [
  { key: 'month_price', label: '月付' },
  { key: 'quarter_price', label: '季付' },
  { key: 'half_year_price', label: '半年付' },
  { key: 'year_price', label: '年付' },
  { key: 'two_year_price', label: '两年付' },
  { key: 'three_year_price', label: '三年付' },
  { key: 'onetime_price', label: '一次性' },
  { key: 'reset_price', label: '流量重置包' },
] as const

type PriceKey = (typeof PRICE_FIELDS)[number]['key']

type FormValues = {
  name: string
  group_id: number
  transfer_enable: number
  device_limit: number | null
  speed_limit: number | null
  capacity_limit: number | null
  reset_traffic_method: number | null
  content: string | null
  force_update: boolean
} & Record<PriceKey, number | null>

interface Props {
  open: boolean
  /** null = 新增 */
  plan: AdminPlan | null
  onClose: () => void
  onSaved: () => void
}

const RESET_OPTIONS = Object.entries(RESET_TRAFFIC_METHODS).map(([v, l]) => ({
  value: Number(v),
  label: l,
}))

/**
 * 表单回填走 Form 的 initialValues，而不是打开弹窗后在 useEffect 里 setFieldsValue：
 * Modal（destroyOnHidden）打开的第一帧还没挂载表单，effect 里写进去的值会在表单挂载时
 * 被 preserve={false} 的字段清掉（StrictMode 下第一次打开就是空的，生产环境第二次打开变空）。
 * 弹窗每次打开都会重新挂载 Form，initialValues 每次都生效。
 * 注意新增模式也是靠这次重新挂载清空上一次的输入：去掉 destroyOnHidden 前要先改回显式 resetFields。
 */
function toFormValues(plan: AdminPlan | null): Partial<FormValues> {
  if (!plan) return { group_id: 1, transfer_enable: 100, force_update: false }
  const prices = Object.fromEntries(
    PRICE_FIELDS.map((f) => [
      f.key,
      plan[f.key] === null || plan[f.key] === undefined
        ? null
        : centsToYuan(plan[f.key] as number),
    ]),
  )
  return {
    name: plan.name,
    group_id: plan.group_id,
    transfer_enable: plan.transfer_enable,
    device_limit: plan.device_limit,
    speed_limit: plan.speed_limit,
    capacity_limit: plan.capacity_limit,
    reset_traffic_method: plan.reset_traffic_method,
    content: plan.content,
    force_update: false,
    ...prices,
  } as Partial<FormValues>
}

export default function PlanEditModal({ open, plan, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const isEdit = plan !== null
  const forceUpdate = Form.useWatch('force_update', form)

  // force_update 改写的是 plan_id 指向本套餐的**全部**用户（含已过期），而 plan.count
  // 只是有效用户数（countActiveUsers），直接拿它当影响人数会少报。所以开关打开时另查一次总数。
  // user/fetch 和 plan/save 一样走 withoutGlobalScopes（跨站点），口径一致。
  const {
    data: affectedTotal,
    isFetching: countingAffected,
    isError: affectedCountFailed,
    refetch: refetchAffected,
  } = useQuery({
    queryKey: ['plan-force-update-affected', plan?.id],
    queryFn: () =>
      fetchUsers({
        current: 1,
        pageSize: 10,
        filter: [{ key: 'plan_id', condition: '=', value: plan!.id }],
      }),
    select: (r) => r.total,
    enabled: open && isEdit && !!forceUpdate,
  })

  /**
   * 影响人数的说明文字，Alert 和二次确认共用。
   * total：number = 查到的总数；null = 统计失败；undefined = 还在统计
   */
  function affectedSummary(total: number | null | undefined): string {
    const active = plan?.count ?? 0
    if (typeof total === 'number') {
      const expired = Math.max(0, total - active)
      return `该套餐下全部 ${total} 个用户（有效 ${active} 个、已过期 ${expired} 个）`
    }
    if (total === null) {
      return `该套餐下全部用户（影响人数未知：有效 ${active} 个，已过期用户的数量没能查到，实际改写的人数可能远多于此）`
    }
    return `该套餐下全部用户（有效 ${active} 个，正在统计含已过期用户的总数…）`
  }

  /**
   * force_update 不可撤销、影响面大，保存前再确认一次。
   * Modal.confirm 的 content 在弹出那一刻就定死了，不会跟着查询结果刷新，
   * 所以调用方必须先等统计出结果（或确定失败）再把数字传进来，
   * 不能让管理员对着「正在统计…」点确认。
   */
  function confirmForceUpdate(
    values: FormValues,
    total: number | null,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      Modal.confirm({
        title: '确认覆盖老用户的配额？',
        content: (
          <>
            <p>
              将改写{affectedSummary(total)}，已过期用户也包括在内。
            </p>
            {/* 中文句子不要在 JSX 里折行：换行会被渲染成一个空格（「GB、 设备数」） */}
            <p>
              覆盖为：权限组 #{values.group_id}、总流量 {values.transfer_enable} GB、设备数{' '}
              {values.device_limit ?? '不限'}、限速{' '}
              {values.speed_limit ? `${values.speed_limit} Mbps` : '不限'}。
            </p>
            <p style={{ marginBottom: 0 }}>
              用户通过礼品卡等方式额外叠加的流量会被抹掉；已用流量不会清零，新流量比已用少的用户会立刻超额。此操作不可撤销。
            </p>
          </>
        ),
        okText: '确认覆盖并保存',
        okButtonProps: { danger: true },
        width: 520,
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })
  }

  async function handleOk() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    if (isEdit && values.force_update) {
      // 先拿到人数再弹确认。cancelRefetch:false：开关刚打开、自动统计还在路上时复用那个请求；
      // 已经有结果时也重查一次，拿保存前一刻的数。统计期间保存按钮转圈，防止连点弹出多个确认框
      setSubmitting(true)
      let total: number | null
      try {
        const r = await refetchAffected({ cancelRefetch: false })
        // 失败时 data 可能还留着上一次的旧数，不能拿来当影响人数
        total = r.isError || r.data === undefined ? null : r.data
      } finally {
        setSubmitting(false)
      }
      if (!(await confirmForceUpdate(values, total))) return
    }
    setSubmitting(true)
    try {
      const prices = Object.fromEntries(
        PRICE_FIELDS.map((f) => [
          f.key,
          values[f.key] === null || values[f.key] === undefined
            ? null
            : yuanToCents(values[f.key] as number),
        ]),
      )
      await savePlan({
        ...(plan ? { id: plan.id } : {}),
        name: values.name,
        group_id: values.group_id,
        transfer_enable: values.transfer_enable,
        content: values.content ?? null,
        device_limit: values.device_limit ?? null,
        speed_limit: values.speed_limit ?? null,
        capacity_limit: values.capacity_limit ?? null,
        reset_traffic_method: values.reset_traffic_method ?? null,
        ...(isEdit && values.force_update ? { force_update: 1 as const } : {}),
        ...prices,
      })
      message.success(isEdit ? '套餐已保存' : '套餐已创建')
      onSaved()
      onClose()
    } catch {
      // 拦截器已提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isEdit ? `编辑套餐「${plan!.name}」` : '新增套餐'}
      onCancel={onClose}
      onOk={handleOk}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      // 开了「同步覆盖」时保存按钮转成危险色，和下方的红色提示呼应
      okButtonProps={{ danger: isEdit && !!forceUpdate }}
      confirmLoading={submitting}
      width={760}
      destroyOnHidden
      maskClosable={false}
      // 240px 时弹窗总高（top 100 + 头 + 尾 + 底边距 24）比视口多 12px，外层 wrap 会跟着滚
      styles={{ body: { maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' } }}
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={toFormValues(plan)}
        className="plan-page-form"
      >
        <FormSection title="基本信息" first>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="套餐名称"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input placeholder="例如：标准套餐" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item
                name="group_id"
                label="权限组 ID"
                tooltip="决定该套餐能用哪些节点"
                rules={[{ required: true, message: '请输入权限组 ID' }]}
              >
                <InputNumber min={1} controls={false} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item
                name="transfer_enable"
                label="总流量"
                tooltip="套餐表里存的就是 GB，不是字节"
                rules={[{ required: true, message: '请输入流量' }]}
              >
                <InputNumber min={0} controls={false} suffix="GB" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        <FormSection title="价格" description="单位：元。留空表示该周期不售">
          <Row gutter={16}>
            {PRICE_FIELDS.map((f) => (
              <Col xs={12} md={6} key={f.key}>
                <Form.Item name={f.key} label={f.label}>
                  <InputNumber
                    min={0}
                    step={0.01}
                    precision={2}
                    controls={false}
                    prefix="¥"
                    style={{ width: '100%' }}
                    placeholder="不售"
                  />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </FormSection>

        <FormSection title="流量与限制" description="留空表示不限">
          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item name="device_limit" label="设备数限制">
                <InputNumber
                  min={0}
                  controls={false}
                  suffix="台"
                  style={{ width: '100%' }}
                  placeholder="不限"
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="speed_limit" label="限速">
                <InputNumber
                  min={0}
                  controls={false}
                  suffix="Mbps"
                  style={{ width: '100%' }}
                  placeholder="不限"
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="capacity_limit" label="容量上限" tooltip="最多容纳的用户人数">
                <InputNumber
                  min={0}
                  controls={false}
                  suffix="人"
                  style={{ width: '100%' }}
                  placeholder="不限"
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="reset_traffic_method" label="流量重置方式">
                <Select
                  allowClear
                  placeholder="跟随全局设置"
                  options={RESET_OPTIONS}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        <FormSection title="其他">
          <Form.Item name="content" label="套餐描述">
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 10 }}
              placeholder="展示给用户的套餐说明，支持 HTML"
            />
          </Form.Item>
        </FormSection>

        {isEdit && (
          <FormSection title="批量同步" description="影响该套餐下所有老用户，谨慎开启">
            <SettingSwitch
              name="force_update"
              title="同步覆盖老用户的配额"
              description="不开启则只改套餐本身，老用户保留原有配额"
            />
            {forceUpdate && (
              <Alert
                type="error"
                showIcon
                className="plan-page-force-alert"
                message={`将同时改写${affectedSummary(
                  countingAffected
                    ? undefined
                    : affectedCountFailed
                      ? null
                      : affectedTotal,
                )}的配额`}
                description={
                  <>
                    <ul className="plan-page-force-list">
                      <li>
                        保存时会把 plan_id 为该套餐的所有用户（不论是否已过期）的权限组、总流量、设备数限制、限速一并覆盖成上面填的值；
                      </li>
                      <li>用户通过礼品卡等方式额外叠加的流量会被抹掉；</li>
                      <li>已用流量不会清零，新流量比已用少的用户会立刻超额。</li>
                    </ul>
                    <div className="plan-page-force-final">这个操作不可撤销。</div>
                  </>
                }
              />
            )}
          </FormSection>
        )}
      </Form>
    </Modal>
  )
}
