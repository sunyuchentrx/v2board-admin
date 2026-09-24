import { useState } from 'react'
import {
  Alert,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  message,
} from 'antd'
import { AppstoreAddOutlined, GiftOutlined, InfoCircleOutlined } from '@ant-design/icons'
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
import FormSection from '@/components/FormSection'
import SettingSwitch from '@/components/SettingSwitch'
import './PromoPages.css'

type GiftcardType = 1 | 2 | 3 | 4 | 5

interface FormValues {
  mode: 'single' | 'batch'
  name: string
  type: GiftcardType
  /** type=1 时是元；type=2/5 是天；type=3 是 GB；type=4 不用填 */
  value?: number
  /** 仅 type=5：勾选才提交 value=0（永久套餐），见 VALUE_META[5] */
  permanent?: boolean
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

/**
 * 各类型 value 的标签、单位与提示，口径来自 GiftcardGenerate.php + CSV 格式化逻辑。
 * 单位放在输入框的前缀/后缀里，label 不再重复写单位。
 */
const VALUE_META: Record<
  GiftcardType,
  { label: string; prefix?: string; suffix?: string; hint: string } | null
> = {
  1: { label: '面值', prefix: '¥', hint: '兑换后直接加到用户余额' },
  2: { label: '时长', suffix: '天', hint: '兑换后延长用户到期时间' },
  3: { label: '流量', suffix: 'GB', hint: '兑换后增加用户总流量' },
  4: null, // 流量重置不需要 value
  // 不是「延长」：UserController::redeemgiftcard 只在用户没有套餐或套餐已过期时才生效，
  // 直接把套餐和到期时间覆盖成「兑换时刻 + value 天」；value == 0 则到期时间置空 = 永久。
  5: {
    label: '时长',
    suffix: '天',
    hint: '仅对没有套餐或套餐已过期的用户有效：直接换成该套餐，从兑换时起算天数',
  },
}

function confirmUnlimitedPermanent(): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: '永久套餐卡且不限兑换次数？',
      content:
        '卡密一旦外流，任何拿到的人都能兑换该套餐的永久订阅，且没有次数上限。建议先填写「可兑换次数」。',
      okText: '仍然生成',
      okButtonProps: { danger: true },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

export default function GiftcardCreateModal({ open, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const mode = Form.useWatch('mode', form) ?? 'single'
  const type = (Form.useWatch('type', form) ?? 1) as GiftcardType
  const valueMeta = VALUE_META[type]
  const permanentChecked = Form.useWatch('permanent', form) === true
  const isPermanent = type === 5 && permanentChecked

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
    // 只有显式勾选「永久」才发 value=0；没勾选时表单已要求至少 1 天
    const permanent = values.type === 5 && values.permanent === true
    if (permanent && values.limit_use == null && !(await confirmUnlimitedPermanent())) {
      return
    }
    setSubmitting(true)
    try {
      const base = {
        name: values.name,
        type: values.type,
        // type=1 后端按分存（CSV 里除以 100 显示）；其余类型是天/GB 原值
        ...(VALUE_META[values.type]
          ? {
              value:
                values.type === 1
                  ? yuanToCents(values.value ?? 0)
                  : permanent
                    ? 0
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
      okText={mode === 'batch' ? '生成并下载' : '创建'}
      cancelText="取消"
      width={640}
      maskClosable={false}
      destroyOnHidden
      styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        preserve={false}
        className="promo-form"
        initialValues={{
          mode: 'single',
          type: 1,
          generate_count: 10,
          range: [dayjs(), dayjs().add(1, 'month')],
        }}
      >
        <FormSection title="基本信息" first>
          <Form.Item name="mode" label="创建方式">
            <Segmented
              block
              className="promo-mode"
              options={[
                { value: 'single', label: '单张', icon: <GiftOutlined /> },
                { value: 'batch', label: '批量生成', icon: <AppstoreAddOutlined /> },
              ]}
            />
          </Form.Item>

          <Alert
            type="warning"
            showIcon
            message="卡密只会返回一次"
            description="后端只在创建响应里回显卡密。批量生成会自动下载 CSV，请务必保存。另外后端没有编辑礼品卡的接口，填错只能删了重建。"
          />

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input placeholder="例如：活动奖励卡" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              {mode === 'batch' && (
                <Form.Item
                  name="generate_count"
                  label="生成数量"
                  tooltip="后端上限 500"
                  rules={[
                    { required: true, message: '请输入数量' },
                    { type: 'number', min: 1, max: 500, message: '1-500' },
                  ]}
                >
                  <InputNumber min={1} max={500} suffix="张" style={{ width: '100%' }} />
                </Form.Item>
              )}
              {mode === 'single' && (
                <Form.Item name="code" label="卡密" tooltip="留空则后端生成 16 位随机码">
                  <Input className="mono" placeholder="留空自动生成" />
                </Form.Item>
              )}
            </Col>
          </Row>
        </FormSection>

        <FormSection title="卡面内容">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="type"
                label="类型"
                rules={[{ required: true, message: '请选择类型' }]}
              >
                <Select
                  style={{ width: '100%' }}
                  options={Object.entries(GIFTCARD_TYPES).map(([v, l]) => ({
                    value: Number(v),
                    label: l,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              {valueMeta ? (
                <Form.Item
                  name="value"
                  label={valueMeta.label}
                  rules={
                    isPermanent
                      ? []
                      : [
                          { required: true, message: '请输入数值' },
                          // type=5 填 0 在后端等于永久套餐，不能让它混在普通天数里被随手填出来
                          ...(type === 5
                            ? [
                                {
                                  type: 'number' as const,
                                  min: 1,
                                  // 要在半列宽里一行放下，不然最后一个字会单独折到第二行
                                  message: '至少 1 天；永久卡请打开「永久套餐」',
                                },
                              ]
                            : []),
                        ]
                  }
                >
                  <InputNumber
                    // 不在输入框上卡 min=1：否则填 0 会被静默吞掉、只提示「请输入数值」，
                    // 让校验规则给出「要永久请打开永久套餐」的明确提示
                    min={0}
                    step={type === 1 ? 0.01 : 1}
                    precision={type === 1 ? 2 : 0}
                    prefix={valueMeta.prefix}
                    // 永久卡不看天数，后缀「天」也去掉
                    suffix={isPermanent ? undefined : valueMeta.suffix}
                    disabled={isPermanent}
                    placeholder={isPermanent ? '永久，无需填写' : type === 1 ? '0.00' : undefined}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              ) : (
                // 流量重置卡没有 value；占住右半列，保持和其它类型同样的两列栅格
                <Form.Item label="面值">
                  <Input disabled placeholder="无需填写" />
                </Form.Item>
              )}
            </Col>
          </Row>

          {type === 5 && (
            // 紧挨着它影响的「时长」：时长的校验错误就是让人来打开这个开关
            <SettingSwitch
              name="permanent"
              title="永久套餐"
              description="兑换后到期时间置空，不限天数"
              onChange={(checked) => {
                if (checked) {
                  // 永久卡不看天数：清掉已填的值和它的校验错误，避免看起来像「N 天」
                  form.setFields([{ name: 'value', value: undefined, errors: [] }])
                }
              }}
            />
          )}

          <div className="promo-hint">
            <InfoCircleOutlined className="promo-hint-icon" />
            <span>
              {isPermanent
                ? '仅对没有套餐或套餐已过期的用户有效：直接换成该套餐的永久订阅'
                : valueMeta
                  ? valueMeta.hint
                  : '流量重置卡不需要面值'}
            </span>
          </div>

          {type === 5 && (
            <>
              <Form.Item
                name="plan_id"
                label="指定套餐"
                rules={[{ required: true, message: '套餐时长卡必须指定套餐' }]}
              >
                <Select
                  placeholder="选择套餐"
                  style={{ width: '100%' }}
                  options={(plans ?? []).map((p) => ({ value: p.id, label: p.name }))}
                />
              </Form.Item>
              {isPermanent && (
                <Alert
                  type="error"
                  showIcon
                  message="这是永久套餐卡"
                  description="每个兑换的用户都会得到该套餐的永久订阅。请务必限制可兑换次数并保管好卡密。后端导出的 CSV 会把它写成「0天」，列表里显示为「永久」。"
                />
              )}
            </>
          )}
        </FormSection>

        <FormSection title="有效期与次数" description="可兑换次数留空表示不限">
          <Row gutter={16}>
            <Col xs={24} md={16}>
              <Form.Item
                name="range"
                label="有效期"
                rules={[{ required: true, message: '请选择有效期' }]}
              >
                <DatePicker.RangePicker showTime style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="limit_use" label="可兑换次数">
                <InputNumber min={1} suffix="次" style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>
      </Form>
    </Modal>
  )
}
