import { useEffect, useState } from 'react'
import {
  Alert,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  message,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { fetchPlans } from '@/api/plan'
import { ORDER_PERIODS } from '@/api/order'
import {
  COUPON_TYPES,
  generateCouponsBatch,
  saveCoupon,
  type AdminCoupon,
} from '@/api/promo'
import { centsToYuan, yuanToCents } from '@/lib/format'
import { downloadText } from '@/lib/download'

interface FormValues {
  mode: 'single' | 'batch'
  name: string
  type: 1 | 2
  /** type=1 时是元，type=2 时是百分比 */
  value: number
  range: [Dayjs, Dayjs]
  // 这几个字段在表单里用 undefined 表示「不限」；提交时才转成后端要的 null。
  // antd 的 setFieldsValue 类型不接受 `T | null`。
  limit_use?: number
  limit_use_with_user?: number
  limit_plan_ids?: number[]
  limit_period?: string[]
  code?: string
  generate_count?: number
}

interface Props {
  open: boolean
  coupon: AdminCoupon | null
  onClose: () => void
  onSaved: () => void
}

export default function CouponEditModal({ open, coupon, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const isEdit = coupon !== null
  const mode = Form.useWatch('mode', form) ?? 'single'
  const type = Form.useWatch('type', form) ?? 1

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    if (coupon) {
      form.setFieldsValue({
        mode: 'single',
        name: coupon.name,
        type: coupon.type as 1 | 2,
        // type=1 库里是分，表单显示元；type=2 就是百分比原值
        value: coupon.type === 1 ? centsToYuan(coupon.value) : coupon.value,
        range: [dayjs(coupon.started_at * 1000), dayjs(coupon.ended_at * 1000)],
        limit_use: coupon.limit_use ?? undefined,
        limit_use_with_user: coupon.limit_use_with_user ?? undefined,
        // 后端返回的是 JSON 字符串，回填成多选值不可靠，留空表示不改动限定范围
        limit_plan_ids: undefined,
        limit_period: undefined,
        code: coupon.code,
      })
    } else {
      form.resetFields()
      form.setFieldsValue({
        mode: 'single',
        type: 1,
        generate_count: 10,
        range: [dayjs(), dayjs().add(1, 'month')],
      } as FormValues)
    }
  }, [open, coupon, form])

  async function handleOk() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      const base = {
        name: values.name,
        type: values.type,
        // type=1 提交分；type=2 提交百分比整数
        value:
          values.type === 1 ? yuanToCents(values.value) : Math.round(values.value),
        started_at: Math.floor(values.range[0].valueOf() / 1000),
        ended_at: Math.floor(values.range[1].valueOf() / 1000),
        limit_use: values.limit_use ?? null,
        limit_use_with_user: values.limit_use_with_user ?? null,
        limit_plan_ids:
          values.limit_plan_ids && values.limit_plan_ids.length > 0
            ? values.limit_plan_ids
            : null,
        limit_period:
          values.limit_period && values.limit_period.length > 0
            ? values.limit_period
            : null,
      }

      if (!isEdit && values.mode === 'batch') {
        const csv = await generateCouponsBatch({
          ...base,
          generate_count: values.generate_count!,
        })
        downloadText(csv, `v2board-coupons-${values.generate_count}.csv`)
        message.success(`已生成 ${values.generate_count} 张券，CSV 已开始下载`)
      } else {
        await saveCoupon({
          ...(coupon ? { id: coupon.id } : {}),
          ...base,
          ...(values.code ? { code: values.code } : {}),
        })
        message.success(isEdit ? '已保存' : '已创建')
      }
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
      title={isEdit ? `编辑优惠券「${coupon!.name}」` : '新增优惠券'}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      width={680}
      destroyOnClose
    >
      <Form<FormValues> form={form} layout="vertical" preserve={false}>
        {!isEdit && (
          <Form.Item name="mode" label="创建方式">
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="single">单张</Radio.Button>
              <Radio.Button value="batch">批量生成</Radio.Button>
            </Radio.Group>
          </Form.Item>
        )}

        {mode === 'batch' && !isEdit && (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="批量生成会返回券码 CSV"
              description="券码只在这次响应里回显，确认后浏览器自动下载。批量生成的券固定为启用状态。"
            />
            <Form.Item
              name="generate_count"
              label="生成数量"
              rules={[
                { required: true, message: '请输入数量' },
                { type: 'number', min: 1, max: 500, message: '1-500' },
              ]}
              extra="后端上限 500"
            >
              <InputNumber min={1} max={500} style={{ width: '100%' }} />
            </Form.Item>
          </>
        )}

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="例如：新春优惠" />
            </Form.Item>
          </Col>
          <Col span={12}>
            {mode === 'single' && (
              <Form.Item
                name="code"
                label="券码"
                extra={isEdit ? '' : '留空则后端生成 8 位随机码'}
              >
                <Input placeholder="留空自动生成" />
              </Form.Item>
            )}
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="type"
              label="优惠类型"
              rules={[{ required: true, message: '请选择类型' }]}
            >
              <Select
                options={Object.entries(COUPON_TYPES).map(([v, l]) => ({
                  value: Number(v),
                  label: l,
                }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="value"
              label={type === 1 ? '优惠金额 (元)' : '折扣比例 (%)'}
              rules={[
                { required: true, message: '请输入数值' },
                { type: 'number', min: 0, message: '不能为负' },
                ...(type === 2
                  ? [{ type: 'number' as const, max: 100, message: '比例最大 100' }]
                  : []),
              ]}
            >
              <InputNumber
                min={0}
                max={type === 2 ? 100 : undefined}
                step={type === 1 ? 0.01 : 1}
                precision={type === 1 ? 2 : 0}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="range"
          label="有效期"
          rules={[{ required: true, message: '请选择有效期' }]}
        >
          <DatePicker.RangePicker showTime style={{ width: '100%' }} />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="limit_use" label="总可用次数">
              <InputNumber min={0} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="limit_use_with_user" label="每人可用次数">
              <InputNumber min={0} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="limit_plan_ids" label="限定套餐">
              <Select
                mode="multiple"
                allowClear
                placeholder="不限"
                options={(plans ?? []).map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="limit_period" label="限定周期">
              <Select
                mode="multiple"
                allowClear
                placeholder="不限"
                options={Object.entries(ORDER_PERIODS).map(([v, l]) => ({
                  value: v,
                  label: l,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}
