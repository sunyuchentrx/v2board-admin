import { useState } from 'react'
import {
  Alert,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  message,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import { fetchPlans } from '@/api/plan'
import { generateSingleUser, generateUsersBatch } from '@/api/user'
import { downloadText } from '@/lib/download'

type Mode = 'single' | 'batch'

interface FormValues {
  mode: Mode
  email_prefix?: string
  email_suffix: string
  generate_count?: number
  plan_id?: number | null
  expired_at?: Dayjs | null
  password?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
}

export default function UserGenerateModal({ open, onClose, onDone }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const mode = Form.useWatch('mode', form) ?? 'single'

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
      const expiredAt = values.expired_at
        ? Math.floor(values.expired_at.valueOf() / 1000)
        : null

      if (values.mode === 'single') {
        await generateSingleUser({
          email_prefix: values.email_prefix!,
          email_suffix: values.email_suffix,
          plan_id: values.plan_id ?? null,
          expired_at: expiredAt,
          ...(values.password ? { password: values.password } : {}),
        })
        message.success('用户已创建')
      } else {
        const csv = await generateUsersBatch({
          generate_count: values.generate_count!,
          email_suffix: values.email_suffix,
          plan_id: values.plan_id ?? null,
          expired_at: expiredAt,
          ...(values.password ? { password: values.password } : {}),
        })
        // 批量生成的响应体是 CSV 文本，里面含明文密码 —— 这是唯一一次能拿到，
        // 关掉弹窗就再也取不回来了，所以直接触发下载而不是只弹个成功提示。
        downloadText(csv, `v2board-users-${values.generate_count}.csv`)
        message.success(
          `已生成 ${values.generate_count} 个用户，账号密码 CSV 已开始下载`,
        )
      }
      onDone()
      onClose()
      form.resetFields()
    } catch {
      // 接口错误由拦截器统一弹出（例如「邮箱已存在于系统中」是 HTTP 500 + message）
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="生成用户"
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      width={560}
      destroyOnClose
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{ mode: 'single', email_suffix: '', generate_count: 10 }}
        preserve={false}
      >
        <Form.Item name="mode" label="生成方式">
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio.Button value="single">单个（指定邮箱）</Radio.Button>
            <Radio.Button value="batch">批量（随机邮箱）</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {mode === 'batch' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="批量生成的明文密码只会返回一次"
            description="后端只在这次响应里回显账号密码，之后数据库里只有哈希值。确认后浏览器会自动下载 CSV，请务必保存好。"
          />
        )}

        {mode === 'single' ? (
          <Form.Item
            name="email_prefix"
            label="邮箱前缀"
            rules={[{ required: true, message: '请输入邮箱前缀' }]}
            extra="最终邮箱 = 前缀 + @ + 后缀"
          >
            <Input placeholder="user001" />
          </Form.Item>
        ) : (
          <Form.Item
            name="generate_count"
            label="生成数量"
            rules={[
              { required: true, message: '请输入数量' },
              { type: 'number', min: 1, max: 500, message: '1-500' },
            ]}
            extra="后端上限 500 个（UserGenerate.php 的校验规则）"
          >
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        )}

        <Form.Item
          name="email_suffix"
          label="邮箱后缀"
          rules={[{ required: true, message: '请输入邮箱后缀' }]}
          extra="不含 @，例如 example.com"
        >
          <Input placeholder="example.com" addonBefore="@" />
        </Form.Item>

        <Form.Item name="plan_id" label="套餐">
          <Select
            allowClear
            placeholder="不分配套餐"
            options={(plans ?? []).map((p) => ({ value: p.id, label: p.name }))}
          />
        </Form.Item>

        <Form.Item name="expired_at" label="到期时间" extra="留空为长期有效">
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="password"
          label="初始密码"
          extra="留空则密码与邮箱相同（后端默认行为）"
        >
          <Input placeholder="留空 = 邮箱同名密码" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
