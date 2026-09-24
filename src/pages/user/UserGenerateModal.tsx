import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Typography,
  message,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import { ApiError } from '@/api/client'
import { fetchPlans } from '@/api/plan'
import {
  clearUnknownOutcome,
  generateSingleUser,
  generateUsersBatch,
  recentUnknownOutcome,
  rememberUnknownOutcome,
  type UnknownOutcomeRecord,
} from '@/api/user'
import { downloadText } from '@/lib/download'
import { formatTime } from '@/lib/format'
import './UserList.css'

type Mode = 'single' | 'batch'

interface FormValues {
  mode: Mode
  email_prefix?: string
  email_suffix: string
  generate_count?: number
  plan_id?: number | null
  expired_at?: Dayjs | null
  password: string
}

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
}

/**
 * 超时 / 断网后「结果未知」时记下的信息。
 * 后端（Workerman 常驻进程）不会因为前端断开而中止，账号很可能已经入库；
 * 密码是前端生成/填写的，所以即使响应丢了，也还能把它告诉管理员。
 */
interface UnknownOutcome {
  mode: Mode
  /** 单个模式：完整邮箱；批量模式：邮箱后缀 */
  email: string
  password: string
}

/** 批量生成超时时记下的信息（见 api/user.ts 的 rememberUnknownOutcome），下次打开时展示 */
interface BatchOutcomeDetail {
  suffix: string
  count: number
}

/**
 * 批量生成超时那次用的初始密码。只放内存、不写进 localStorage（明文密码不落盘），
 * 刷新页面就没了。按 at 和持久化的记录对上号，避免别的标签页的新记录配上这里的旧密码。
 */
let batchOutcomePassword: { at: number; password: string } | null = null

/** 去掉 0/O、1/l/I 这类手抄易混的字符：56 个字符，16 位约 93 bit 熵 */
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const PASSWORD_LENGTH = 16

/**
 * 用 crypto.getRandomValues 生成随机初始密码。
 *
 * 为什么前端要自己生成：后端 generate / multiGenerate 在没传 password 时执行
 * `password_hash($request->input('password') ?? $user['email'])`（UserController.php:231/267），
 * 也就是**密码 = 邮箱**。邮箱会出现在邀请、工单、客服沟通里，知道邮箱就能登录前台拿订阅。
 */
function randomPassword(): string {
  const n = PASSWORD_ALPHABET.length
  // 拒绝采样：256 不是 56 的整数倍，直接 byte % 56 会让前 32 个字符概率偏高
  const limit = 256 - (256 % n)
  let out = ''
  while (out.length < PASSWORD_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(PASSWORD_LENGTH * 2))
    for (const b of bytes) {
      if (b < limit && out.length < PASSWORD_LENGTH) out += PASSWORD_ALPHABET[b % n]
    }
  }
  return out
}

/** 一行可复制的凭证：左侧小标签，右侧等宽字体的值 + 复制按钮 */
function SecretRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="user-page-secret">
      <span className="user-page-secret-label">{label}</span>
      <Typography.Text
        className="user-page-secret-value"
        copyable={{ text: value, tooltips: ['复制', '已复制'] }}
      >
        {value}
      </Typography.Text>
    </div>
  )
}

/** 单个模式成功后展示一次账号密码 —— 后端只存哈希，关掉就再也看不到了 */
function showCreatedCredentials(email: string, password: string) {
  Modal.success({
    title: '用户已创建',
    width: 520,
    okText: '我已保存',
    content: (
      <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 4 }}>
        <div>
          <SecretRow label="账号" value={email} />
          <SecretRow label="初始密码" value={password} />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          后端只保存密码哈希，关闭后无法再查看。请复制交给用户，并提醒其登录后修改。
        </Typography.Text>
      </Space>
    ),
  })
}

export default function UserGenerateModal({ open, onClose, onDone }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [unknownOutcome, setUnknownOutcome] = useState<UnknownOutcome | null>(null)
  // 上一次批量生成超时留下的记录（打开时读）。有就必须先勾选「已核实」才能再批量生成
  const [previous, setPrevious] =
    useState<UnknownOutcomeRecord<BatchOutcomeDetail> | null>(null)
  const [previousChecked, setPreviousChecked] = useState(false)
  const mode = Form.useWatch('mode', form) ?? 'single'
  // 只用于「最终邮箱」预览（纯展示，提交仍以 validateFields 的值为准）
  const previewPrefix = (Form.useWatch('email_prefix', form) ?? '').trim()
  const previewSuffix = (Form.useWatch('email_suffix', form) ?? '').trim()
  const previewCount = Form.useWatch('generate_count', form)

  // 每次打开预填一个新的随机密码（弹窗 destroyOnHidden，表单每次打开都重新挂载读 initialValues）
  const initialPassword = useMemo(() => (open ? randomPassword() : ''), [open])

  // unknownOutcome 只锁当次打开：单个模式重试同一个邮箱，后端会报「邮箱已存在于系统中」，
  // 不会重复建号，关窗刷新列表也能按邮箱查到。批量不一样 —— 邮箱是后端随机生成的，
  // 重试不会撞唯一约束，而是再多出一整批，所以批量的超时记录跨弹窗保留（previous）。
  useEffect(() => {
    if (!open) return
    setUnknownOutcome(null)
    setPrevious(recentUnknownOutcome<BatchOutcomeDetail>('user.generateBatch'))
    setPreviousChecked(false)
  }, [open])

  const previousPassword =
    previous && batchOutcomePassword?.at === previous.at
      ? batchOutcomePassword.password
      : null
  const blockedByPrevious = mode === 'batch' && previous !== null && !previousChecked

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    enabled: open,
  })

  function handleCancel() {
    // 超时后关闭：刷新列表，让管理员看到后端实际生成了什么
    if (unknownOutcome) onDone()
    onClose()
  }

  async function handleOk() {
    if (unknownOutcome || blockedByPrevious) return
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    // 后端 TrimStrings 会去掉首尾空格，这里先 trim，保证展示给管理员的邮箱与实际入库的一致
    const suffix = values.email_suffix.trim()
    const password = values.password
    const email =
      values.mode === 'single' ? `${values.email_prefix!.trim()}@${suffix}` : suffix

    setSubmitting(true)
    try {
      const expiredAt = values.expired_at
        ? Math.floor(values.expired_at.valueOf() / 1000)
        : null

      if (values.mode === 'single') {
        await generateSingleUser({
          email_prefix: values.email_prefix!.trim(),
          email_suffix: suffix,
          plan_id: values.plan_id ?? null,
          expired_at: expiredAt,
          password,
        })
        showCreatedCredentials(email, password)
      } else {
        const csv = await generateUsersBatch({
          generate_count: values.generate_count!,
          email_suffix: suffix,
          plan_id: values.plan_id ?? null,
          expired_at: expiredAt,
          password,
        })
        // 批量生成的响应体是 CSV 文本，里面含明文密码 —— 这是唯一一次能拿到，
        // 关掉弹窗就再也取不回来了，所以直接触发下载而不是只弹个成功提示。
        downloadText(csv, `v2board-users-${values.generate_count}.csv`)
        clearUnknownOutcome('user.generateBatch')
        batchOutcomePassword = null
        message.success(
          `已生成 ${values.generate_count} 个用户，账号密码 CSV 已开始下载`,
        )
      }
      onDone()
      onClose()
      form.resetFields()
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // 超时 / 断网：没有响应不等于没执行。批量生成是先 insert + commit 再 echo CSV，
        // 此时重试会再生成一整批，所以锁住确定按钮，让管理员先刷新确认。
        setUnknownOutcome({ mode: values.mode, email, password })
        if (values.mode === 'batch') {
          const at = rememberUnknownOutcome<BatchOutcomeDetail>('user.generateBatch', {
            suffix,
            count: values.generate_count!,
          })
          batchOutcomePassword = { at, password }
        }
      }
      // 其他接口错误由拦截器统一弹出（例如「邮箱已存在于系统中」是 HTTP 500 + message）
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="生成用户"
      onCancel={handleCancel}
      onOk={handleOk}
      confirmLoading={submitting}
      okText={
        unknownOutcome
          ? '结果未知，请刷新确认'
          : mode === 'batch'
            ? '生成并下载 CSV'
            : '创建用户'
      }
      cancelText="取消"
      okButtonProps={{ disabled: unknownOutcome !== null || blockedByPrevious }}
      // 执行中不许关：关掉再打开就能重复提交，而前一个请求在后端还在跑
      closable={!submitting}
      keyboard={!submitting}
      maskClosable={!submitting}
      cancelButtonProps={{ disabled: submitting }}
      width={640}
      destroyOnHidden
      // body 限高 100vh - 240 后弹窗最高约 100vh - 88（头 + 尾约 152px），top 44 让长弹窗上下留白一致；
      // 默认 top 100 时底部只剩约 12px，遮罩还会多出一截滚动。不用 centered：切换内容时弹窗会上下跳
      style={{ top: 44 }}
      styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
    >
      <div className="user-page-stack">
        {unknownOutcome && (
          <Alert
            type="error"
            showIcon
            message={
              unknownOutcome.mode === 'single'
                ? '请求超时：用户可能已经创建，切勿重复提交'
                : '请求超时：这批用户可能已经生成，切勿重复提交'
            }
            description={
              <div className="user-page-alert-body">
                {unknownOutcome.mode === 'single' ? (
                  <p>
                    后端不会因为前端断开而中止。请关闭此窗口（会自动刷新列表），按邮箱{' '}
                    <Typography.Text code>{unknownOutcome.email}</Typography.Text> 查找确认。
                  </p>
                ) : (
                  <p>
                    后端是先把账号写入数据库、再返回 CSV 的，重复提交会再生成一整批。请关闭此窗口（会自动刷新列表），按邮箱后缀{' '}
                    <Typography.Text code>@{unknownOutcome.email}</Typography.Text>{' '}
                    筛选确认；CSV 已无法取回，订阅地址可以用「导出 CSV」按同样条件导出。
                  </p>
                )}
                <p>如果已经创建，初始密码如下，请先复制保存：</p>
                <SecretRow label="初始密码" value={unknownOutcome.password} />
              </div>
            }
          />
        )}

        {/* 当次又超时了就只看上面那条，不重复 */}
        {mode === 'batch' && previous && !unknownOutcome && (
          <Alert
            type="error"
            showIcon
            message={`上一次批量生成（${formatTime(Math.floor(previous.at / 1000))}，@${previous.detail.suffix}，${previous.detail.count} 个）请求超时，结果未知`}
            description={
              <div className="user-page-alert-body">
                <p>
                  后端是先把账号写入数据库、再返回 CSV 的，超时不代表没生成；邮箱又是随机的，再提交一次会多出一整批。请先在用户列表按邮箱后缀{' '}
                  <Typography.Text code>@{previous.detail.suffix}</Typography.Text>{' '}
                  筛选，确认上一批有没有入库。
                </p>
                {previousPassword && (
                  <>
                    <p>如果已经生成，那批账号的初始密码是：</p>
                    <SecretRow label="初始密码" value={previousPassword} />
                  </>
                )}
                <Checkbox
                  checked={previousChecked}
                  disabled={submitting}
                  onChange={(e) => setPreviousChecked(e.target.checked)}
                >
                  我已核实上一次的实际结果，确认这次不是重复提交
                </Checkbox>
              </div>
            }
          />
        )}

        {submitting && mode === 'batch' && (
          <Alert
            type="info"
            showIcon
            message="正在生成，数量多时可能需要一两分钟，请不要关闭页面或重复提交"
          />
        )}
      </div>

      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{
          mode: 'single',
          email_suffix: '',
          generate_count: 10,
          password: initialPassword,
        }}
        preserve={false}
        disabled={submitting || unknownOutcome !== null}
      >
        <Form.Item name="mode" label="生成方式">
          <Radio.Group
            block
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'single', label: '单个（指定邮箱）' },
              { value: 'batch', label: '批量（随机邮箱）' },
            ]}
          />
        </Form.Item>

        {mode === 'batch' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 18 }}
            message="批量生成的明文密码只会返回一次"
            description="后端只在这次响应里回显账号密码，之后数据库里只有哈希值。确认后浏览器会自动下载 CSV，请务必保存好。"
          />
        )}

        <Row gutter={16}>
          <Col xs={24} sm={12}>
            {mode === 'single' ? (
              <Form.Item
                name="email_prefix"
                label="邮箱前缀"
                tooltip="最终邮箱 = 前缀 + @ + 后缀"
                rules={[{ required: true, whitespace: true, message: '请输入邮箱前缀' }]}
              >
                <Input placeholder="user001" />
              </Form.Item>
            ) : (
              <Form.Item
                name="generate_count"
                label="生成数量"
                tooltip="后端上限 500 个（UserGenerate.php 的校验规则）"
                rules={[
                  { required: true, message: '请输入数量' },
                  { type: 'number', min: 1, max: 500, message: '1-500' },
                ]}
              >
                <InputNumber min={1} max={500} style={{ width: '100%' }} placeholder="1-500" />
              </Form.Item>
            )}
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="email_suffix"
              label="邮箱后缀"
              tooltip="不含 @，例如 example.com"
              // whitespace：纯空格能过 required，但后端 TrimStrings 会把它变成 null → 422
              rules={[
                { required: true, whitespace: true, message: '请输入邮箱后缀' },
                { pattern: /^[^@]*$/, message: '不要包含 @' },
              ]}
            >
              <Input placeholder="example.com" prefix={<span className="muted">@</span>} />
            </Form.Item>
          </Col>
        </Row>

        <div className="user-page-preview">
          {mode === 'single' ? (
            <>
              <span className="user-page-preview-label">最终邮箱</span>
              {previewPrefix || previewSuffix ? (
                <span className="mono">
                  {previewPrefix || '…'}@{previewSuffix || '…'}
                </span>
              ) : (
                <span>填写前缀和后缀后在这里预览</span>
              )}
            </>
          ) : (
            <>
              <span className="user-page-preview-label">将生成</span>
              <span>
                <strong className="tabular-nums">{previewCount || '—'}</strong> 个随机邮箱
                {previewSuffix ? (
                  <>
                    ，形如 <span className="mono">xxxxxx@{previewSuffix}</span>
                    （前缀为 6 位随机字符）
                  </>
                ) : (
                  '，填写后缀后预览'
                )}
              </span>
            </>
          )}
        </div>

        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="plan_id" label="套餐">
              <Select
                allowClear
                placeholder="不分配套餐"
                style={{ width: '100%' }}
                options={(plans ?? []).map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="expired_at" label="到期时间" tooltip="留空为长期有效">
              <DatePicker showTime style={{ width: '100%' }} placeholder="长期有效" />
            </Form.Item>
          </Col>
        </Row>

        {/* 必填：后端留空时密码 = 邮箱（见 randomPassword 注释），所以默认随机生成而不是留空 */}
        <Form.Item
          label="初始密码"
          required
          extra={
            mode === 'batch'
              ? '已默认随机生成。后端对整批只接受一个密码，这批账号会共用它（CSV 每行都带着）；需要每个账号独立密码请用单个模式逐个生成，或提醒用户登录后修改。'
              : '已默认随机生成。创建成功后会显示一次，请复制交给用户。'
          }
        >
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item
              name="password"
              noStyle
              rules={[
                { required: true, message: '请输入初始密码，或点「随机生成」' },
                // 前台登录 AuthLogin 要求 min:8，更短的密码生成出来也登录不了
                { min: 8, message: '至少 8 位（前台登录要求）' },
                // 后端不会 trim 密码（TrimStrings 的 $except 里有 password），存进去的就是原样。
                // 拦首尾空格是因为它在复制、转发给用户的过程中很容易丢，丢了用户就登录不上。
                {
                  validator: (_, value: string | undefined) =>
                    !value || value === value.trim()
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error('首尾不能有空格（复制、转发时容易丢失，用户会登录不上）'),
                        ),
                },
              ]}
            >
              <Input.Password
                className="user-page-password-input"
                autoComplete="new-password"
                placeholder="至少 8 位"
              />
            </Form.Item>
            <Button
              icon={<ReloadOutlined />}
              onClick={() =>
                form.setFields([
                  { name: 'password', value: randomPassword(), errors: [] },
                ])
              }
            >
              随机生成
            </Button>
          </Space.Compact>
        </Form.Item>
      </Form>
    </Modal>
  )
}
