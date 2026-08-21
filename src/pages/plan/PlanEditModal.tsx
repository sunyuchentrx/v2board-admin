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
import {
  RESET_TRAFFIC_METHODS,
  savePlan,
  type AdminPlan,
} from '@/api/plan'
import { centsToYuan, yuanToCents } from '@/lib/format'

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

export default function PlanEditModal({ open, plan, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const isEdit = plan !== null
  const forceUpdate = Form.useWatch('force_update', form)

  useEffect(() => {
    if (!open) return
    if (plan) {
      const prices = Object.fromEntries(
        PRICE_FIELDS.map((f) => [
          f.key,
          plan[f.key] === null || plan[f.key] === undefined
            ? null
            : centsToYuan(plan[f.key] as number),
        ]),
      )
      form.setFieldsValue({
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
      } as FormValues)
    } else {
      form.resetFields()
      form.setFieldsValue({ group_id: 1, transfer_enable: 100, force_update: false } as FormValues)
    }
  }, [open, plan, form])

  async function handleOk() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
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
      confirmLoading={submitting}
      width={760}
      destroyOnClose
      maskClosable={false}
    >
      <Form<FormValues> form={form} layout="vertical" preserve={false}>
        <Row gutter={16}>
          <Col span={10}>
            <Form.Item
              name="name"
              label="套餐名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="例如：标准套餐" />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item
              name="group_id"
              label="权限组 ID"
              rules={[{ required: true, message: '请输入权限组 ID' }]}
              extra="决定该套餐能用哪些节点"
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item
              name="transfer_enable"
              label="流量 (GB)"
              rules={[{ required: true, message: '请输入流量' }]}
              extra="套餐表里存的就是 GB，不是字节"
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={6}>
            <Form.Item name="device_limit" label="设备数限制">
              <InputNumber min={0} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="speed_limit" label="限速 (Mbps)">
              <InputNumber min={0} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="capacity_limit" label="容量上限（人数）">
              <InputNumber min={0} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="reset_traffic_method" label="流量重置方式">
              <Select
                allowClear
                placeholder="跟随全局设置"
                options={Object.entries(RESET_TRAFFIC_METHODS).map(([v, l]) => ({
                  value: Number(v),
                  label: l,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>
          价格（元，留空表示该周期不售）
        </Divider>
        <Row gutter={16}>
          {PRICE_FIELDS.map((f) => (
            <Col span={6} key={f.key}>
              <Form.Item name={f.key} label={f.label}>
                <InputNumber
                  min={0}
                  step={0.01}
                  precision={2}
                  style={{ width: '100%' }}
                  placeholder="不售"
                />
              </Form.Item>
            </Col>
          ))}
        </Row>

        <Form.Item name="content" label="套餐描述">
          <Input.TextArea rows={3} placeholder="展示给用户的套餐说明，支持 HTML" />
        </Form.Item>

        {isEdit && (
          <>
            <Divider orientation="left" plain>
              批量同步
            </Divider>
            <Form.Item
              name="force_update"
              label="同步覆盖老用户的配额"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            {forceUpdate && (
              <Alert
                type="error"
                showIcon
                message={`将同时改写该套餐下全部 ${plan!.count} 个用户的配额`}
                description="开启后，保存时会把这些用户的权限组、总流量、设备数限制、限速一并覆盖成上面填的值。不开启则只改套餐本身，老用户保留原有配额。这个操作不可撤销。"
              />
            )}
          </>
        )}
      </Form>
    </Modal>
  )
}
