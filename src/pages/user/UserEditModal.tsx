import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Typography,
  message,
  type InputNumberProps,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { ApiError } from '@/api/client'
import { fetchPlans } from '@/api/plan'
import { describeCouponRate } from '@/api/promo'
import FormSection from '@/components/FormSection'
import SettingSwitch from '@/components/SettingSwitch'
import {
  getUserInfoById,
  updateUser,
  type AdminUser,
  type UserUpdatePayload,
} from '@/api/user'
import {
  bytesToGiB,
  centsToYuan,
  giBToBytes,
  yuanToCents,
} from '@/lib/format'
import './UserList.css'

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

type UserDetail = Awaited<ReturnType<typeof getUserInfoById>>

/**
 * 详情加载状态。只有 ready 才允许保存：
 * 邀请人邮箱只能从详情里拿到，详情没到（或失败）时表单里那一栏是空的，
 * 这时保存会让后端把 invite_user_id 置 null —— 静默解除邀请关系。
 */
type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' }

/** 后端字段名 → 表单字段名。换算过单位的字段两边名字不同，422 要靠这张表落到输入框上 */
const FIELD_ERROR_TARGET: Record<string, keyof FormValues> = {
  email: 'email',
  password: 'password',
  transfer_enable: 'transfer_enable_gib',
  u: 'u_gib',
  d: 'd_gib',
  device_limit: 'device_limit',
  speed_limit: 'speed_limit',
  expired_at: 'expired_at',
  banned: 'banned',
  is_admin: 'is_admin',
  is_staff: 'is_staff',
  plan_id: 'plan_id',
  commission_rate: 'commission_rate',
  discount: 'discount',
  commission_type: 'commission_type',
  balance: 'balance_yuan',
  commission_balance: 'commission_balance_yuan',
  remarks: 'remarks',
}

function toFormValues(u: UserDetail): FormValues {
  return {
    email: u.email,
    password: '',
    transfer_enable_gib: bytesToGiB(u.transfer_enable),
    u_gib: bytesToGiB(u.u),
    d_gib: bytesToGiB(u.d),
    device_limit: u.device_limit,
    speed_limit: u.speed_limit,
    // expired_at: null = 长期有效，0 = 未订阅（两者都不给日期）
    expired_at: u.expired_at ? dayjs(u.expired_at * 1000) : null,
    neverExpire: u.expired_at === null,
    banned: u.banned === 1,
    is_admin: u.is_admin === 1,
    is_staff: u.is_staff === 1,
    plan_id: u.plan_id,
    commission_rate: u.commission_rate,
    discount: u.discount,
    commission_type: u.commission_type ?? 0,
    balance_yuan: centsToYuan(u.balance),
    commission_balance_yuan: centsToYuan(u.commission_balance),
    remarks: u.remarks,
    // 邀请人已不存在时后端给的是 invite_user: null，所以要用可选链
    invite_user_email: u.invite_user?.email ?? null,
  }
}

/**
 * 到期时间三态：长期有效(null) / 指定时间(时间戳) / 未设置(0)。
 * 未选日期且未勾长期有效时传 0 —— 传 null 会变成长期有效。
 */
function toExpiredAt(values: FormValues): number | null {
  if (values.neverExpire) return null
  if (values.expired_at) return Math.floor(values.expired_at.valueOf() / 1000)
  return 0
}

/**
 * 数值输入 + 单位。antd 5.29 起 InputNumber 的 addonAfter / addonBefore 已废弃，
 * 改用 Space.Compact + Space.Addon 拼出同样的外观。Form.Item 注入的 value / onChange / id
 * 原样转给 InputNumber，校验状态走 context，不受外层包装影响。
 */
function UnitNumber({
  unit,
  unitBefore,
  ...props
}: Omit<InputNumberProps<number>, 'addonAfter' | 'addonBefore'> & {
  unit: ReactNode
  /** 单位放在输入框前面（货币符号） */
  unitBefore?: boolean
}) {
  const addon = <Space.Addon className="user-page-unit">{unit}</Space.Addon>
  return (
    <Space.Compact block>
      {unitBefore && addon}
      <InputNumber<number> {...props} style={{ width: '100%' }} />
      {!unitBefore && addon}
    </Space.Compact>
  )
}

/**
 * 专属折扣的实时说明（纯展示）。值是**减免**比例，和按比例优惠券同一语义（见 describeCouponRate）：
 * 10 = 九折、90 = 一折、100 = 免费；后端 setVipDiscount 用 `if ($user->discount)`，所以 0 和留空都是没有折扣。
 */
function discountHint(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return '留空或 0：没有专属折扣'
  const desc = describeCouponRate(value)
  return desc === '免费' ? `减免 ${value}%，即免费` : `减免 ${value}%，即 ${desc}`
}

export default function UserEditModal({ open, user, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [detailState, setDetailState] = useState<DetailState>({
    status: 'loading',
  })
  const [reloadSeq, setReloadSeq] = useState(0)
  /** 本次打开拉到的最新详情：既是回填来源，也是判断「改没改」的基准 */
  const baselineRef = useRef<UserDetail | null>(null)
  const userId = user?.id

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    enabled: open,
  })

  /**
   * 表单**只用打开时现拉的 getUserInfoById 回填，而且每次打开只回填一次**。
   *
   * 不用列表行 `user` 回填：那是上次刷新列表时的快照，页面开多久它就旧多久；
   * 期间节点每分钟上报的流量、用户用余额下的单、续费、到账的佣金，都会被旧快照覆盖回去。
   * 邀请人邮箱也只有详情里有（列表只给 invite_user_id）。
   *
   * 不走 react-query：它的缓存（staleTime 30s）会让重新打开时先拿到旧详情，
   * 后台 refetch 回来还会再 setFieldsValue 一次，把管理员改了一半的字段冲掉。
   * 这里明确「一次打开 = 一次请求 = 一次回填」，失败了由管理员手动点重试。
   */
  useEffect(() => {
    if (!open || userId === undefined) return
    let cancelled = false
    setDetailState({ status: 'loading' })
    getUserInfoById(userId).then(
      (detail) => {
        if (cancelled) return
        if (!detail) {
          setDetailState({ status: 'error', message: '后端没有返回该用户的数据' })
          return
        }
        baselineRef.current = detail
        // 用 setFields + touched:false 而不是 setFieldsValue：rc-field-form 2.x 的
        // setFieldsValue 会把值有变化的字段标成 touched，回填完就全是「改过」了。
        form.setFields(
          Object.entries(toFormValues(detail)).map(([name, value]) => ({
            name: name as keyof FormValues,
            value,
            touched: false,
          })),
        )
        setDetailState({ status: 'ready' })
      },
      (error: unknown) => {
        if (cancelled) return
        // 拦截器已弹过全局提示；这里把原因留在弹窗里，并禁止保存
        setDetailState({
          status: 'error',
          message: error instanceof Error ? error.message : '未知错误',
        })
      },
    )
    return () => {
      cancelled = true
      baselineRef.current = null
      // 关闭时复位，保证下次打开的第一帧就是「加载中」，确定按钮不会先闪成可点
      setDetailState({ status: 'loading' })
    }
  }, [open, userId, reloadSeq, form])

  async function handleSubmit() {
    const base = baselineRef.current
    if (!user || !base || detailState.status !== 'ready') return
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return // antd 已在表单上标红
    }

    const payload: UserUpdatePayload = {
      id: user.id,
      email: values.email,
      banned: values.banned ? 1 : 0,
      is_admin: values.is_admin ? 1 : 0,
      is_staff: values.is_staff ? 1 : 0,
      // 这两项必须每次都带：后端把缺省解释为清空分组 / 解除邀请关系
      plan_id: values.plan_id ?? null,
      invite_user_email: values.invite_user_email || null,
    }
    // 空字符串必须不传，否则后端 min:8 会 422
    if (values.password) payload.password = values.password

    // 其余字段后端「不传就不改」，所以只提交和打开时的最新值不一样的：
    //   - 避免把打开弹窗之后后端发生的变化（流量上报、余额下单、续费、佣金到账）覆盖回去；
    //   - 避免流量经 GB 两位小数换算的精度损失（每次最多约 ±5MB，<5MB 的已用量直接归零）。
    // 除流量外，其余字段的换算都是无损的（分↔元、秒↔dayjs），直接和原始值比较即可。

    /**
     * 流量字段界面上是四舍五入到 0.01 GB 的值，所以和「回填时显示的值」比。
     * 例外：原值不足 0.005 GB 时界面本来就显示 0，管理员手动输入 0 / 清空是想清零，
     * 这时靠 isFieldTouched 区分（回填用 setFields touched:false，只有管理员动过才为真）。
     */
    const trafficChanged = (
      name: 'transfer_enable_gib' | 'u_gib' | 'd_gib',
      bytes: number,
    ) => {
      const shown = values[name]
      if (shown !== bytesToGiB(bytes)) return true
      return form.isFieldTouched(name) && !shown && !!bytes
    }
    if (trafficChanged('transfer_enable_gib', base.transfer_enable)) {
      payload.transfer_enable = giBToBytes(values.transfer_enable_gib)
    }
    if (trafficChanged('u_gib', base.u)) payload.u = giBToBytes(values.u_gib)
    if (trafficChanged('d_gib', base.d)) payload.d = giBToBytes(values.d_gib)

    const expiredAt = toExpiredAt(values)
    if (expiredAt !== base.expired_at) payload.expired_at = expiredAt

    const balance = yuanToCents(values.balance_yuan)
    if (balance !== base.balance) payload.balance = balance
    const commissionBalance = yuanToCents(values.commission_balance_yuan)
    if (commissionBalance !== base.commission_balance) {
      payload.commission_balance = commissionBalance
    }

    // 设备数 / 限速在用户购买套餐时也会被后端改写（OrderService），同样只在改过时提交
    const nullable = <T,>(v: T | null | undefined) => v ?? null
    if (nullable(values.device_limit) !== nullable(base.device_limit)) {
      payload.device_limit = nullable(values.device_limit)
    }
    if (nullable(values.speed_limit) !== nullable(base.speed_limit)) {
      payload.speed_limit = nullable(values.speed_limit)
    }
    if (nullable(values.commission_rate) !== nullable(base.commission_rate)) {
      payload.commission_rate = nullable(values.commission_rate)
    }
    if (nullable(values.discount) !== nullable(base.discount)) {
      payload.discount = nullable(values.discount)
    }
    if ((values.commission_type ?? 0) !== (base.commission_type ?? 0)) {
      payload.commission_type = values.commission_type ?? 0
    }
    // 空字符串与 null 等价：后端 ConvertEmptyStringsToNull 会把 '' 存成 null
    if ((values.remarks || null) !== (base.remarks || null)) {
      payload.remarks = values.remarks || null
    }

    setSubmitting(true)
    try {
      await updateUser(payload)
      message.success('已保存')
      onSaved()
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        // updateUser 传了 handle422，拦截器不弹 422，这里必须自己把错误展示出来：
        // 能对上输入框的标在表单上，对不上的合并成一条提示，不能静默丢掉。
        const mapped: { name: keyof FormValues; errors: string[] }[] = []
        const unmapped: string[] = []
        for (const [name, errors] of Object.entries(error.fieldErrors ?? {})) {
          const target = FIELD_ERROR_TARGET[name]
          if (target) mapped.push({ name: target, errors })
          else unmapped.push(errors.join('，'))
        }
        if (mapped.length > 0) form.setFields(mapped)
        if (unmapped.length > 0 || mapped.length === 0) {
          message.error(unmapped.join('；') || error.message)
        }
      }
      // 其他错误（含 abort(500,'邮箱已被使用') 这类业务错误）已由拦截器弹出
    } finally {
      setSubmitting(false)
    }
  }

  const neverExpire = Form.useWatch('neverExpire', form)
  const discount = Form.useWatch('discount', form)
  const loadingDetail = detailState.status === 'loading'

  return (
    <Modal
      open={open}
      title={
        user ? (
          <span className="user-page-modal-title">
            <span>编辑用户 #{user.id}</span>
            <Typography.Text type="secondary" className="user-page-modal-subtitle" ellipsis>
              {user.email}
            </Typography.Text>
          </span>
        ) : (
          '编辑用户'
        )
      }
      onCancel={onClose}
      onOk={handleSubmit}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      // 详情没成功加载前不许保存（见 DetailState 注释）
      okButtonProps={{ disabled: detailState.status !== 'ready' }}
      width={760}
      destroyOnHidden
      maskClosable={false}
      // body 限高 100vh - 240 后弹窗最高约 100vh - 112（头 + 尾约 128px），top 56 让长弹窗上下各留 56px；
      // 默认 top 100 时底部只剩约 12px，遮罩还会多出一截滚动。不用 centered：切换内容时弹窗会上下跳
      style={{ top: 56 }}
      styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
    >
      {detailState.status === 'error' ? (
        // 加载失败时它是弹窗里唯一的内容，不留下边距，上下才对称
        <Alert
          type="error"
          showIcon
          message="用户详情加载失败，暂时不能保存"
          description={
            <div className="user-page-alert-body">
              <p>{detailState.message}</p>
              <p>
                为避免用不完整的数据覆盖用户（例如把邀请关系清空），详情加载成功之前不允许保存。
              </p>
            </div>
          }
          action={
            <Button size="small" onClick={() => setReloadSeq((n) => n + 1)}>
              重试
            </Button>
          }
        />
      ) : (
        <Spin spinning={loadingDetail}>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 20 }}
            message="套餐和邀请人每次保存都会按表单当前值提交"
            // 说明默认只露一行，需要时展开：完整显示时手机上要占掉 7 行，把表单挤到下面
            description={
              <Typography.Paragraph
                className="user-page-alert-collapse"
                ellipsis={{
                  rows: 1,
                  expandable: 'collapsible',
                  symbol: (expanded) => (expanded ? '收起' : '展开说明'),
                }}
              >
                后端更新接口把缺省的套餐当作清空用户分组、把缺省的邀请人邮箱当作解除邀请关系，所以这两项总是提交。表单已按打开时的最新数据回填；流量、余额、佣金、到期时间等其余字段只在你改动过时才提交，没动过的保持后端当前值不变。
              </Typography.Paragraph>
            }
          />

          {/* 加载中禁用整个表单：Spin 只挡鼠标，挡不住键盘 Tab 进输入框 */}
          <Form<FormValues>
            form={form}
            layout="vertical"
            preserve={false}
            disabled={loadingDetail}
          >
            <FormSection title="账号" first>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
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
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="password"
                    label="新密码"
                    tooltip="留空表示不修改密码"
                    rules={[{ min: 8, message: '密码至少 8 位' }]}
                  >
                    <Input.Password placeholder="留空则不修改" autoComplete="new-password" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="remarks" label="备注">
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} placeholder="仅管理员可见" />
              </Form.Item>
            </FormSection>

            <FormSection title="订阅">
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="plan_id"
                    label="套餐"
                    tooltip="每次保存都会按当前值提交；清空即取消套餐"
                  >
                    <Select
                      allowClear
                      placeholder="无订阅"
                      style={{ width: '100%' }}
                      options={(plans ?? []).map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  {/*
                    长期有效时只是把日期框藏起来（hidden 仍保留字段注册和原值，关掉开关原日期还在），
                    换成一个只读的「长期有效」，免得界面上同时出现「长期有效」和一个具体到期日。
                    提交仍走 toExpiredAt，neverExpire 优先。
                  */}
                  <Form.Item name="expired_at" label="到期时间" hidden={!!neverExpire}>
                    <DatePicker showTime style={{ width: '100%' }} placeholder="未订阅" />
                  </Form.Item>
                  <Form.Item label="到期时间" hidden={!neverExpire}>
                    <Input disabled value="长期有效" />
                  </Form.Item>
                </Col>
              </Row>
              <SettingSwitch
                name="neverExpire"
                title="长期有效"
                description="开启后不再有到期时间，已选的到期时间会被忽略（关闭后恢复）"
              />
            </FormSection>

            <FormSection title="流量与限制">
              <Row gutter={16}>
                <Col xs={24} sm={8}>
                  <Form.Item name="transfer_enable_gib" label="总流量">
                    <UnitNumber unit="GB" min={0} step={1} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name="u_gib" label="已用上行">
                    <UnitNumber unit="GB" min={0} step={0.01} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name="d_gib" label="已用下行">
                    <UnitNumber unit="GB" min={0} step={0.01} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col xs={12} sm={12}>
                  <Form.Item name="device_limit" label="设备数限制">
                    <UnitNumber unit="台" min={0} placeholder="不限" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={12}>
                  <Form.Item name="speed_limit" label="限速">
                    <UnitNumber unit="Mbps" min={0} placeholder="不限" />
                  </Form.Item>
                </Col>
              </Row>
            </FormSection>

            <FormSection title="资金与推广">
              <Row gutter={16}>
                <Col xs={12} sm={12}>
                  <Form.Item name="balance_yuan" label="余额">
                    <UnitNumber unit="¥" unitBefore min={0} step={0.01} precision={2} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={12}>
                  <Form.Item name="commission_balance_yuan" label="佣金余额">
                    <UnitNumber unit="¥" unitBefore min={0} step={0.01} precision={2} />
                  </Form.Item>
                </Col>
              </Row>
              {/* 这一行两项都带 extra，高度一致，不会把下一行挤歪 */}
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="commission_rate"
                    label="返佣比例"
                    tooltip="该用户作为邀请人时，被邀请人下单按这个比例给他返佣"
                    rules={[{ type: 'number', min: 0, max: 100, message: '0-100' }]}
                    extra="留空或 0：使用全局默认比例"
                  >
                    <UnitNumber unit="%" min={0} max={100} placeholder="全局默认" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="discount"
                    label="专属折扣（减免比例）"
                    tooltip="填的是减免比例，不是「打几折」：10 = 九折，90 = 一折，100 = 免费。和按比例优惠券同一算法，按套餐原价计算，可与优惠券叠加（合计不超过原价）。"
                    rules={[{ type: 'number', min: 0, max: 100, message: '0-100' }]}
                    extra={discountHint(discount)}
                  >
                    <UnitNumber unit="%" min={0} max={100} placeholder="无" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="commission_type"
                    label="返佣模式"
                    tooltip="该用户作为邀请人时，被邀请人的哪些订单给他返佣"
                  >
                    <Select
                      style={{ width: '100%' }}
                      options={[
                        { value: 0, label: '跟随全局设置' },
                        { value: 1, label: '循环返佣（每单都返）' },
                        { value: 2, label: '仅首单返佣' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="invite_user_email"
                    label="邀请人邮箱"
                    tooltip="每次保存都会按当前值提交；留空则解除邀请关系"
                  >
                    <Input placeholder="无邀请人" allowClear />
                  </Form.Item>
                </Col>
              </Row>
            </FormSection>

            <FormSection title="权限与状态">
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <SettingSwitch
                    name="banned"
                    title="封禁"
                    description="同时踢掉全部登录会话"
                  />
                </Col>
                <Col xs={24} sm={12}>
                  <SettingSwitch name="is_admin" title="管理员" description="可登录管理后台" />
                </Col>
              </Row>
              {/*
                后端 StaffRoute：工单、公告之外，员工还能调 user/update、user/ban、user/sendMail。
                这是授权开关，说明必须写全，所以单独占一整行，不挤在三分之一宽的卡片里折成三行
              */}
              <SettingSwitch
                name="is_staff"
                title="员工（客服）"
                description="可进员工后台：处理工单、发公告、编辑 / 封禁用户、群发邮件"
              />
            </FormSection>
          </Form>
        </Spin>
      )}
    </Modal>
  )
}
