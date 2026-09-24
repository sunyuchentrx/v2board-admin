import { useEffect, useRef, useState } from 'react'
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
import {
  AppstoreAddOutlined,
  InfoCircleOutlined,
  TagOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { fetchPlans } from '@/api/plan'
import { ORDER_PERIODS } from '@/api/order'
import {
  COUPON_TYPES,
  describeCouponRate,
  generateCouponsBatch,
  parseJsonArray,
  saveCoupon,
  type AdminCoupon,
  type CouponSavePayload,
} from '@/api/promo'
import { centsToYuan, yuanToCents } from '@/lib/format'
import { downloadText } from '@/lib/download'
import FormSection from '@/components/FormSection'
import './PromoPages.css'

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

/**
 * 编辑时只提交相对打开弹窗时**有改动**的限制字段，没改的整个省略（后端就不会动这一列）。
 *
 * 原因见 CouponSavePayload 的注释：显式传 null 会把列写成 NULL。
 * limit_plan_ids / limit_period 被写成 NULL = 取消限制；limit_use 是**剩余**次数，
 * 把列表快照里的旧值写回去，等于把这段时间被用掉的次数又送了回去。
 * 回填本身也做对了（见 toPlanIds），这里是第二道保险：哪怕回填出了偏差，没改就不会覆盖。
 *
 * 不用 form.isFieldTouched 判断「动没动」：setFieldsValue 回填时 rc-field-form 会把值有变化的
 * 字段标成 touched，回填完所有字段都是 touched。直接和回填时的原值比较才可靠。
 */
const LIMIT_KEYS = [
  'limit_use',
  'limit_use_with_user',
  'limit_plan_ids',
  'limit_period',
] as const

type LimitKey = (typeof LIMIT_KEYS)[number]
type LimitPayload = Pick<CouponSavePayload, LimitKey>

/** 减免比例达到这个值要二次确认（填 50 以上 = 五折以下） */
const LARGE_RATE = 50

/**
 * 限定套餐回填成多选值。下拉选项的 value 是数字 p.id，历史数据里 id 可能存成字符串，
 * 不转数字就对不上选项。后端 in_array 是宽松比较，转成数字再提交也不影响校验。
 */
function toPlanIds(raw: AdminCoupon['limit_plan_ids']): number[] {
  return parseJsonArray(raw)
    .map(Number)
    .filter((id) => Number.isFinite(id))
}

function toPeriods(raw: AdminCoupon['limit_period']): string[] {
  return parseJsonArray(raw).map(String)
}

/** 表单里的限制字段 → 提交形态：空值 / 空数组都是 null（= 不限） */
function normalizeLimits(v: Pick<FormValues, LimitKey>): Required<LimitPayload> {
  return {
    limit_use: v.limit_use ?? null,
    limit_use_with_user: v.limit_use_with_user ?? null,
    limit_plan_ids: v.limit_plan_ids && v.limit_plan_ids.length > 0 ? v.limit_plan_ids : null,
    limit_period: v.limit_period && v.limit_period.length > 0 ? v.limit_period : null,
  }
}

/** 打开弹窗时回填的原值，按同样的规则规整，供提交时比对 */
function originalLimits(c: AdminCoupon): Required<LimitPayload> {
  return normalizeLimits({
    limit_use: c.limit_use ?? undefined,
    limit_use_with_user: c.limit_use_with_user ?? undefined,
    limit_plan_ids: toPlanIds(c.limit_plan_ids),
    limit_period: toPeriods(c.limit_period),
  })
}

function sameLimit(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    // 多选的先后顺序没有意义
    const x = a.map(String).sort()
    const y = b.map(String).sort()
    return x.length === y.length && x.every((item, i) => item === y[i])
  }
  return a === b
}

/**
 * 放在 <Form> 里面、跟表单项同一次提交挂载，挂载时执行一次回填。
 *
 * 不在外层 useEffect([open]) 里 setFieldsValue：Modal(destroyOnHidden，旧名 destroyOnClose) 的内容比外层 effect
 * 晚一拍才挂载，开发环境 StrictMode 又会把新挂载的 Form.Item 卸载再装回，preserve={false}
 * 的字段卸载时会被重置成 initialValues —— 外层早先填进去的值全丢，编辑弹窗打开是空的。
 * 放在这里，StrictMode 重放 effect 时会再填一次；生产环境行为不变。
 */
function FillOnMount({ fill }: { fill: () => void }) {
  const fillRef = useRef(fill)
  fillRef.current = fill
  useEffect(() => {
    fillRef.current()
  }, [])
  return null
}

/** 有风险的设置先让管理员确认一次，返回是否继续。okText 跟主按钮的动词一致（保存 / 创建 / 生成） */
function confirmRisky(lines: string[], okText: string): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: '请确认以下设置',
      content: (
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ),
      okText,
      okButtonProps: { danger: true },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

export default function CouponEditModal({ open, coupon, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const isEdit = coupon !== null
  const mode = Form.useWatch('mode', form) ?? 'single'
  const type = Form.useWatch('type', form) ?? 1
  const rate = Form.useWatch('value', form)

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    enabled: open,
  })

  // 每次打开弹窗（表单重新挂载）时回填，见 FillOnMount
  function fillForm() {
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
        // 必须按真实值回填：以前这里固定留空，下拉框显示「不限」，保存时又发了 null，
        // 受限券一编辑就变成全站通用券。模型 cast 成 array 通常是数组，也兼容 JSON 字符串。
        limit_plan_ids: toPlanIds(coupon.limit_plan_ids),
        limit_period: toPeriods(coupon.limit_period),
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
  }

  async function handleOk() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    // 限制字段：新增时空值发 null（= 不限）；编辑时没改动的整个省略，见 LIMIT_KEYS
    const limits: LimitPayload = normalizeLimits(values)
    if (coupon) {
      const original = originalLimits(coupon)
      for (const key of LIMIT_KEYS) {
        if (sameLimit(limits[key], original[key])) delete limits[key]
      }
    }

    // 二次确认：大比例减免（新填或改过比例时）；编辑时主动清空了原有的限定范围
    const risky: string[] = []
    const rateChanged =
      !coupon || values.type !== coupon.type || Math.round(values.value) !== coupon.value
    if (values.type === 2 && values.value >= LARGE_RATE && rateChanged) {
      const v = values.value
      const actual = describeCouponRate(v)
      // 「误读」= 把减免比例当成打几折（填 55 以为是 5.5 折）。只有误读和实际折数不同才提示；
      // 填 50 时两者恰好都是 5 折，再说「不是 5 折」反而把正确理解否定掉了。
      const misread = `${v / 10} 折`
      risky.push(
        `减免比例 ${v}%：用户只付原价的 ${100 - v}%（${actual}）${
          v < 100 && misread !== actual ? `，不是「${misread}」` : ''
        }。`,
      )
    }
    if (
      coupon &&
      limits.limit_plan_ids === null &&
      toPlanIds(coupon.limit_plan_ids).length > 0
    ) {
      risky.push('清空了「限定套餐」：这张券今后可用于所有套餐。')
    }
    if (
      coupon &&
      limits.limit_period === null &&
      toPeriods(coupon.limit_period).length > 0
    ) {
      risky.push('清空了「限定周期」：这张券今后可用于所有付费周期。')
    }
    const confirmOkText = coupon
      ? '确认保存'
      : values.mode === 'batch'
        ? '确认生成'
        : '确认创建'
    if (risky.length > 0 && !(await confirmRisky(risky, confirmOkText))) return

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
        ...limits,
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

  const isBatch = mode === 'batch' && !isEdit

  return (
    <Modal
      open={open}
      title={isEdit ? `编辑优惠券「${coupon!.name}」` : '新增优惠券'}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      okText={isEdit ? '保存' : isBatch ? '生成并下载' : '创建'}
      cancelText="取消"
      width={640}
      maskClosable={false}
      destroyOnHidden
      styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
    >
      <Form<FormValues> form={form} layout="vertical" preserve={false} className="promo-form">
        <FillOnMount fill={fillForm} />

        <FormSection title="基本信息" first>
          {!isEdit && (
            <Form.Item name="mode" label="创建方式">
              <Segmented
                block
                className="promo-mode"
                options={[
                  { value: 'single', label: '单张', icon: <TagOutlined /> },
                  { value: 'batch', label: '批量生成', icon: <AppstoreAddOutlined /> },
                ]}
              />
            </Form.Item>
          )}

          {isBatch && (
            <Alert
              type="warning"
              showIcon
              message="批量生成会返回券码 CSV"
              description="券码只在这次响应里回显，确认后浏览器自动下载。批量生成的券固定为启用状态。"
            />
          )}

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input placeholder="例如：新春优惠" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              {isBatch && (
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
                <Form.Item
                  name="code"
                  label="券码"
                  tooltip={isEdit ? undefined : '留空则后端生成 8 位随机码'}
                >
                  <Input className="mono" placeholder="留空自动生成" />
                </Form.Item>
              )}
            </Col>
          </Row>
        </FormSection>

        <FormSection
          title="优惠内容"
          description="固定金额按元直接抵扣；按比例减免按原价减掉一定比例"
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="type"
                label="优惠类型"
                rules={[{ required: true, message: '请选择类型' }]}
              >
                <Segmented
                  block
                  options={Object.entries(COUPON_TYPES).map(([v, l]) => ({
                    value: Number(v),
                    label: l,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="value"
                // type=2 是「减免」比例：CouponService 把 total * value / 100 当优惠额，
                // 叫「折扣比例」会让人把 90 当成九折，实际是一折
                label={type === 1 ? '优惠金额' : '减免比例'}
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
                  prefix={type === 1 ? '¥' : undefined}
                  suffix={type === 2 ? '%' : undefined}
                  placeholder={type === 1 ? '0.00' : '例如 10 = 9 折'}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
          {type === 2 && (
            <div
              className={`promo-hint${
                typeof rate === 'number' && rate >= LARGE_RATE ? ' is-warning' : ''
              }`}
            >
              {typeof rate === 'number' && rate >= LARGE_RATE ? (
                <WarningOutlined className="promo-hint-icon" />
              ) : (
                <InfoCircleOutlined className="promo-hint-icon" />
              )}
              <span>
                按原价减免的比例，不是「打几折」：填 10 = 9 折，填 100 = 免费
                {typeof rate === 'number' && (
                  <>
                    。当前：
                    <strong>
                      减 {rate}% → {describeCouponRate(rate)}
                    </strong>
                  </>
                )}
              </span>
            </div>
          )}
        </FormSection>

        <FormSection
          title="有效期与次数"
          description={
            // 后端每用一次就把 limit_use 减 1（CouponService::use），编辑时看到的是剩余次数
            isEdit
              ? '剩余次数每用一次减 1，不改动则保存时不覆盖；次数留空表示不限'
              : '次数留空表示不限'
          }
        >
          <Form.Item
            name="range"
            label="有效期"
            rules={[{ required: true, message: '请选择有效期' }]}
          >
            <DatePicker.RangePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="limit_use" label={isEdit ? '剩余可用次数' : '总可用次数'}>
                <InputNumber min={0} suffix="次" style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="limit_use_with_user" label="每人可用次数">
                <InputNumber min={0} suffix="次" style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
          </Row>
        </FormSection>

        <FormSection title="使用范围" description="留空表示不限：所有套餐、所有付费周期都能用">
          <Form.Item name="limit_plan_ids" label="限定套餐">
            <Select
              mode="multiple"
              allowClear
              placeholder="不限"
              optionFilterProp="label"
              style={{ width: '100%' }}
              options={(plans ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          <Form.Item name="limit_period" label="限定周期">
            <Select
              mode="multiple"
              allowClear
              placeholder="不限"
              optionFilterProp="label"
              style={{ width: '100%' }}
              options={Object.entries(ORDER_PERIODS).map(([v, l]) => ({
                value: v,
                label: l,
              }))}
            />
          </Form.Item>
        </FormSection>
      </Form>
    </Modal>
  )
}
