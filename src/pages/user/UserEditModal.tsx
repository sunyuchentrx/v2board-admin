import { useEffect, useState } from 'react'
import {
  Alert,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Switch,
  Spin,
  message,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { ApiError } from '@/api/client'
import { fetchPlans } from '@/api/plan'
import { getUserInfoById, updateUser, type AdminUser } from '@/api/user'
import {
  bytesToGiB,
  centsToYuan,
  giBToBytes,
  yuanToCents,
} from '@/lib/format'

interface FormValues {
  email: string
  password?: string
  transfer_enable_gib: number
  u_gib: number
  d_gib: number
  device_limit: number | null
  speed_limit: number | null
  /** null 表示长期有效 */
  expired_at: Dayjs | null
  neverExpire: boolean
  banned: boolean
  is_admin: boolean
  is_staff: boolean
  plan_id: number | null
  commission_rate: number | null
  discount: number | null
  commission_type: number
  balance_yuan: number
  commission_balance_yuan: number
  remarks: string | null
  invite_user_email: string | null
}

interface Props {
  open: boolean
  user: AdminUser | null
  onClose: () => void
  onSaved: () => void
}

export default function UserEditModal({ open, user, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    enabled: open,
  })

  // 邀请人邮箱不在列表响应里（列表只给 invite_user_id），
  // 得单独取详情才拿得到。getUserInfoById 有邀请人时会附带 invite_user 对象。
  const { data: detail, isFetching: loadingDetail } = useQuery({
    queryKey: ['user-detail', user?.id],
    queryFn: () => getUserInfoById(user!.id),
    enabled: open && !!user?.id,
  })

  useEffect(() => {
    if (!open || !user) return
    form.setFieldsValue({
      email: user.email,
      password: '',
      transfer_enable_gib: bytesToGiB(user.transfer_enable),
      u_gib: bytesToGiB(user.u),
      d_gib: bytesToGiB(user.d),
      device_limit: user.device_limit,
      speed_limit: user.speed_limit,
      // expired_at: null = 长期有效，0 = 未订阅（两者都不给日期）
      expired_at: user.expired_at ? dayjs(user.expired_at * 1000) : null,
      neverExpire: user.expired_at === null,
      banned: user.banned === 1,
      is_admin: user.is_admin === 1,
      is_staff: user.is_staff === 1,
      plan_id: user.plan_id,
      commission_rate: user.commission_rate,
      discount: user.discount,
      commission_type: user.commission_type ?? 0,
      balance_yuan: centsToYuan(user.balance),
      commission_balance_yuan: centsToYuan(user.commission_balance),
      remarks: user.remarks,
      invite_user_email: detail?.invite_user?.email ?? null,
    })
  }, [open, user, detail, form])

  async function handleSubmit() {
    if (!user) return
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return // antd 已在表单上标红
    }

    setSubmitting(true)
    try {
      // 到期时间三态：长期有效(null) / 指定时间(时间戳) / 未设置(0 → 传 null 会变长期有效，
      // 所以未选日期且未勾长期有效时保持原值语义，传 0)
      let expiredAt: number | null
      if (values.neverExpire) {
        expiredAt = null
      } else if (values.expired_at) {
        expiredAt = Math.floor(values.expired_at.valueOf() / 1000)
      } else {
        expiredAt = 0
      }

      await updateUser({
        id: user.id,
        email: values.email,
        // 空字符串必须不传，否则后端 min:8 会 422
        ...(values.password ? { password: values.password } : {}),
        transfer_enable: giBToBytes(values.transfer_enable_gib),
        u: giBToBytes(values.u_gib),
        d: giBToBytes(values.d_gib),
        device_limit: values.device_limit ?? null,
        speed_limit: values.speed_limit ?? null,
        expired_at: expiredAt,
        banned: values.banned ? 1 : 0,
        is_admin: values.is_admin ? 1 : 0,
        is_staff: values.is_staff ? 1 : 0,
        plan_id: values.plan_id ?? null,
        commission_rate: values.commission_rate ?? null,
        discount: values.discount ?? null,
        commission_type: values.commission_type ?? 0,
        balance: yuanToCents(values.balance_yuan),
        commission_balance: yuanToCents(values.commission_balance_yuan),
        remarks: values.remarks ?? null,
        invite_user_email: values.invite_user_email || null,
      })
      message.success('已保存')
      onSaved()
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        // 拦截器不弹 422，映射到表单字段。后端字段名与表单名不完全一致，
        // 换算过的字段（流量/金额）落不到对应输入框，退化成整体提示。
        const entries = Object.entries(error.fieldErrors ?? {})
        // 只有名字与表单字段同名的才能落到输入框上；换算过的字段
        // （transfer_enable→GB、balance→元）后端名与表单名不同，落不上去。
        const known: (keyof FormValues)[] = [
          'email',
          'password',
          'device_limit',
          'speed_limit',
          'plan_id',
          'commission_rate',
          'discount',
          'remarks',
        ]
        const fields = entries
          .filter(([name]) => known.includes(name as keyof FormValues))
          .map(([name, errors]) => ({
            name: name as keyof FormValues,
            errors,
          }))
        if (fields.length > 0) {
          form.setFields(fields)
        } else {
          message.error(entries.map(([, v]) => v.join('，')).join('；') || error.message)
        }
      }
      // 其他错误（含 abort(500,'邮箱已被使用') 这类业务错误）已由拦截器弹出
    } finally {
      setSubmitting(false)
    }
  }

  const neverExpire = Form.useWatch('neverExpire', form)

  return (
    <Modal
      open={open}
      title={user ? `编辑用户 #${user.id}` : '编辑用户'}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      width={780}
      destroyOnClose
      maskClosable={false}
    >
      <Spin spinning={loadingDetail}>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="保存会整体覆盖以下所有字段"
          description="后端的更新接口是整体覆盖语义：不提交套餐会同时清空用户分组，不填邀请人邮箱会解除邀请关系。本表单已把当前完整状态回填，请确认后再保存。"
        />

        <Form<FormValues> form={form} layout="vertical" preserve={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '邮箱格式不正确' },
                ]}
              >
                <Input placeholder="user@example.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="password"
                label="新密码"
                rules={[{ min: 8, message: '密码至少 8 位' }]}
                extra="留空表示不修改密码"
              >
                <Input.Password placeholder="留空则不改" autoComplete="new-password" />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" plain>
            订阅
          </Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="plan_id" label="套餐">
                <Select
                  allowClear
                  placeholder="无订阅"
                  options={(plans ?? []).map((p) => ({
                    value: p.id,
                    label: p.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="neverExpire"
                label="长期有效"
                valuePropName="checked"
                extra="开启后不再有到期时间"
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="expired_at" label="到期时间">
                <DatePicker
                  showTime
                  style={{ width: '100%' }}
                  disabled={neverExpire}
                  placeholder={neverExpire ? '长期有效' : '未订阅'}
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" plain>
            流量与限制
          </Divider>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="transfer_enable_gib" label="总流量 (GB)">
                <InputNumber min={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="u_gib" label="已用上行 (GB)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="d_gib" label="已用下行 (GB)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="device_limit" label="设备数限制">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="speed_limit" label="限速 (Mbps)">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="不限" />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" plain>
            资金与推广
          </Divider>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="balance_yuan" label="余额 (元)">
                <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="commission_balance_yuan" label="佣金 (元)">
                <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="commission_rate"
                label="返佣比例 (%)"
                rules={[{ type: 'number', min: 0, max: 100, message: '0-100' }]}
              >
                <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="用全局默认" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="discount"
                label="专属折扣 (%)"
                rules={[{ type: 'number', min: 0, max: 100, message: '0-100' }]}
              >
                <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="无" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="commission_type" label="返佣模式">
                <Select
                  options={[
                    { value: 0, label: '跟随全局设置' },
                    { value: 1, label: '循环返佣（每单都返）' },
                    { value: 2, label: '仅首单返佣' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="invite_user_email"
                label="邀请人邮箱"
                extra="留空则解除邀请关系"
              >
                <Input placeholder="无邀请人" allowClear />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" plain>
            状态
          </Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="banned"
                label="封禁"
                valuePropName="checked"
                extra="封禁会同时踢掉该用户全部登录会话"
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="is_admin" label="管理员" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="is_staff" label="员工（客服）" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="remarks" label="备注">
            <Input.TextArea rows={2} placeholder="仅管理员可见" />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  )
}
