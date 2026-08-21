import { useState } from 'react'
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
import {
  generateGiftcardsBatch,
  GIFTCARD_TYPES,
  saveGiftcard,
} from '@/api/promo'
import { yuanToCents } from '@/lib/format'
import { downloadText } from '@/lib/download'

type GiftcardType = 1 | 2 | 3 | 4 | 5

interface FormValues {
  mode: 'single' | 'batch'
  name: string
  type: GiftcardType
  /** type=1 时是元；type=2/5 是天；type=3 是 GB；type=4 不用填 */
  value?: number
  plan_id?: number
  range: [Dayjs, Dayjs]
  limit_use: number | null
  code?: string
  generate_count?: number
}

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

/** 各类型 value 的标签与提示，口径来自 GiftcardGenerate.php + CSV 格式化逻辑 */
const VALUE_META: Record<GiftcardType, { label: string; hint: string } | null> = {
  1: { label: '面值 (元)', hint: '兑换后直接加到用户余额' },
  2: { label: '时长 (天)', hint: '兑换后延长用户到期时间' },
  3: { label: '流量 (GB)', hint: '兑换后增加用户总流量' },
  4: null, // 流量重置不需要 value
  5: { label: '时长 (天)', hint: '兑换后按指定套餐延长到期时间' },
}

export default function GiftcardCreateModal({ open, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const mode = Form.useWatch('mode', form) ?? 'single'
  const type = (Form.useWatch('type', form) ?? 1) as GiftcardType
  const valueMeta = VALUE_META[type]

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    enabled: open,
  })

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
        // type=1 后端按分存（CSV 里除以 100 显示）；其余类型是天/GB 原值
        ...(valueMeta
          ? {
              value:
                values.type === 1
                  ? yuanToCents(values.value ?? 0)
                  : Math.round(values.value ?? 0),
            }
          : {}),
        ...(values.type === 5 ? { plan_id: values.plan_id ?? null } : {}),
        started_at: Math.floor(values.range[0].valueOf() / 1000),
        ended_at: Math.floor(values.range[1].valueOf() / 1000),
        limit_use: values.limit_use ?? null,
      }

      if (values.mode === 'batch') {
        const csv = await generateGiftcardsBatch({
          ...base,
          generate_count: values.generate_count!,
        })
        downloadText(csv, `v2board-giftcards-${values.generate_count}.csv`)
        message.success(`已生成 ${values.generate_count} 张卡，卡密 CSV 已开始下载`)
      } else {
        await saveGiftcard({
          ...base,
          ...(values.code ? { code: values.code } : {}),
        })
        message.success('礼品卡已创建')
      }
      onSaved()
      onClose()
      form.resetFields()
    } catch {
      // 拦截器已提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="生成礼品卡"
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      width={620}
      destroyOnClose
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          mode: 'single',
          type: 1,
          generate_count: 10,
          range: [dayjs(), dayjs().add(1, 'month')],
        }}
      >
        <Form.Item name="mode" label="创建方式">
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio.Button value="single">单张</Radio.Button>
            <Radio.Button value="batch">批量生成</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="卡密只会返回一次"
          description="后端只在创建响应里回显卡密。批量生成会自动下载 CSV，请务必保存。另外后端没有编辑礼品卡的接口，填错只能删了重建。"
        />

        {mode === 'batch' && (
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
        )}

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="例如：活动奖励卡" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="type"
              label="类型"
              rules={[{ required: true, message: '请选择类型' }]}
            >
              <Select
                options={Object.entries(GIFTCARD_TYPES).map(([v, l]) => ({
                  value: Number(v),
                  label: l,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {valueMeta && (
            <Col span={12}>
              <Form.Item
                name="value"
                label={valueMeta.label}
                rules={[{ required: true, message: '请输入数值' }]}
                extra={valueMeta.hint}
              >
                <InputNumber
                  min={0}
                  step={type === 1 ? 0.01 : 1}
                  precision={type === 1 ? 2 : 0}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          )}
          {type === 5 && (
            <Col span={12}>
              <Form.Item
                name="plan_id"
                label="指定套餐"
                rules={[{ required: true, message: '套餐时长卡必须指定套餐' }]}
              >
                <Select
                  placeholder="选择套餐"
                  options={(plans ?? []).map((p) => ({ value: p.id, label: p.name }))}
                />
              </Form.Item>
            </Col>
          )}
          {type === 4 && (
            <Col span={12}>
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 30 }}
                message="流量重置卡不需要面值"
              />
            </Col>
          )}
        </Row>

        <Row gutter={16}>
          <Col span={16}>
            <Form.Item
              name="range"
              label="有效期"
              rules={[{ required: true, message: '请选择有效期' }]}
            >
              <DatePicker.RangePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="limit_use" label="可兑换次数">
              <InputNumber min={1} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
          </Col>
        </Row>

        {mode === 'single' && (
          <Form.Item name="code" label="卡密" extra="留空则后端生成 16 位随机码">
            <Input placeholder="留空自动生成" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
