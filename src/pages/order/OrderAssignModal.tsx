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
import { MailOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { fetchPlans, type AdminPlan } from '@/api/plan'
import { assignOrder, ORDER_PERIODS, type OrderPeriod } from '@/api/order'
import { formatMoney, yuanToCents } from '@/lib/format'
import './OrderPage.css'

interface FormValues {
  email: string
  plan_id: number
  period: OrderPeriod
  amount_yuan: number
}

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
}

/** 套餐表里各周期的价格列名与 period 值同名，可以直接取 */
function planPrice(plan: AdminPlan | undefined, period: OrderPeriod) {
  if (!plan) return null
  const value = (plan as unknown as Record<string, number | null>)[period]
  return typeof value === 'number' ? value : null
}

export default function OrderAssignModal({ open, onClose, onDone }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)

  const {
    data: plans,
    isLoading: plansLoading,
    isError: plansError,
  } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    enabled: open,
  })

  const planId = Form.useWatch('plan_id', form)
  const period = Form.useWatch('period', form)
  const selectedPlan = plans?.find((p) => p.id === planId)
  const suggestedCents = planPrice(selectedPlan, period)

  async function handleOk() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      const tradeNo = await assignOrder({
        email: values.email,
        plan_id: values.plan_id,
        period: values.period,
        total_amount: yuanToCents(values.amount_yuan),
      })
      message.success(`订单已创建：${tradeNo}（待支付）`)
      onDone()
      onClose()
      form.resetFields()
    } catch {
      // 业务错误（用户不存在 / 已有待支付订单）由拦截器弹出
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="手动开单"
      onCancel={onClose}
      onOk={handleOk}
      okText="创建订单"
      cancelText="取消"
      confirmLoading={submitting}
      width={640}
      maskClosable={false}
      destroyOnHidden
      className="order-page-assign"
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="创建出来是「待支付」订单，不会自动开通"
        description="需要回到列表对这张订单点「标记支付」，才会真正为用户开通订阅并派发佣金。若该用户已有待支付订单，后端会拒绝创建。"
      />

      <Form<FormValues> form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="email"
          label="用户邮箱"
          rules={[
            { required: true, message: '请输入用户邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
          tooltip="必须是系统里已存在的用户"
        >
          <Input
            placeholder="user@example.com"
            prefix={<MailOutlined className="order-page-icon" />}
            autoComplete="off"
          />
        </Form.Item>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="plan_id"
              label="套餐"
              rules={[{ required: true, message: '请选择套餐' }]}
            >
              <Select
                style={{ width: '100%' }}
                placeholder="选择套餐"
                // 用 isLoading 而不是 !plans：请求失败时要停止转圈，而不是一直转下去
                loading={plansLoading}
                notFoundContent={plansError ? '套餐列表加载失败，请关闭后重试' : undefined}
                showSearch
                optionFilterProp="label"
                options={(plans ?? []).map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="period"
              label="周期"
              rules={[{ required: true, message: '请选择周期' }]}
            >
              <Select
                style={{ width: '100%' }}
                placeholder="选择周期"
                options={Object.entries(ORDER_PERIODS).map(([v, l]) => ({
                  value: v,
                  label: l,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="amount_yuan"
          label="订单金额"
          rules={[
            { required: true, message: '请输入金额' },
            { type: 'number', min: 0, message: '金额不能为负' },
          ]}
          // 两种提示用同一种包装，选了套餐前后字号不跳
          extra={
            suggestedCents !== null ? (
              <>
                该套餐此周期的标价为{' '}
                <span className="order-page-money">{formatMoney(suggestedCents)}</span>
                ，可改成任意金额（填 0 即赠送）
              </>
            ) : (
              <>填 0 表示赠送。金额可与套餐标价不同。</>
            )
          }
        >
          <InputNumber
            min={0}
            step={0.01}
            precision={2}
            prefix="¥"
            style={{ width: '100%' }}
            placeholder="0.00"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
