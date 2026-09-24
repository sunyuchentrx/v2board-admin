import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import {
  banUsersByFilter,
  clearUnknownOutcome,
  deleteUsersByFilter,
  fetchUsers,
  recentUnknownOutcome,
  rememberUnknownOutcome,
  sendMailByFilter,
  type UnknownOutcomeKind,
  type UserFilter,
} from '@/api/user'
import { formatTime } from '@/lib/format'
import './UserList.css'

export type BulkAction = 'ban' | 'allDel' | 'sendMail'

interface Props {
  action: BulkAction | null
  /** 当前生效的过滤条件。空数组 = 作用于全部用户 */
  filters: UserFilter[]
  onClose: () => void
  onDone: () => void
}

const ACTION_META: Record<
  BulkAction,
  {
    title: string
    verb: string
    danger: boolean
    needTypedConfirm: boolean
    /** 是否要单独统计并提示命中的管理员账号 */
    guardAdmins: boolean
    /** 超时（结果未知）时给管理员的说明 */
    unknownHint: string
    /**
     * 超时后要跨弹窗记住的操作（见 api/user.ts 的 rememberUnknownOutcome）。
     * 只有群发需要：封禁 / 删除关窗刷新列表就能看出结果，重试也基本幂等；
     * 群发刷新列表看不出任何痕迹，重发却会让所有人收到两封。
     */
    repeatGuard?: { kind: UnknownOutcomeKind; hint: string }
  }
> = {
  ban: {
    title: '批量封禁用户',
    verb: '封禁',
    danger: true,
    needTypedConfirm: true,
    guardAdmins: true,
    unknownHint:
      '后端不会因为前端断开而中止，封禁可能已经完成或仍在进行。请关闭此窗口（会自动刷新列表）确认结果，不要直接重试。',
  },
  allDel: {
    title: '批量删除用户',
    verb: '删除',
    danger: true,
    needTypedConfirm: true,
    guardAdmins: true,
    unknownHint:
      '后端不会因为前端断开而中止，删除可能已经完成或仍在进行。请关闭此窗口（会自动刷新列表）确认结果，不要直接重试。',
  },
  sendMail: {
    title: '群发邮件',
    verb: '发送邮件给',
    danger: false,
    needTypedConfirm: false,
    guardAdmins: false,
    unknownHint:
      '群发任务可能已经全部或部分入队。重复提交会让收件人收到重复邮件，还可能让 SMTP 账号被判定为垃圾发送。请先到「系统状态」的队列监控确认，切勿重复提交。',
    repeatGuard: {
      kind: 'user.sendMail',
      hint: '群发任务可能已经全部或部分入队，但用户列表里看不出来。请先到「系统状态」查看 send_email_mass 队列是否处理过这批任务，或找一个收件人确认是否收到；确认上一次没有发出之后再继续。',
    },
  },
}

/** 超时时记下的群发信息，重新打开时拿来和这次比对 */
interface BulkOutcomeDetail {
  filters: UserFilter[]
  count: number
  subject?: string
}

/** 统计命中的管理员用 */
const ONLY_ADMINS: UserFilter = { key: 'is_admin', condition: '=', value: '1' }
/** 「排除管理员」时追加到执行条件里的那一条 */
const EXCLUDE_ADMINS: UserFilter = { key: 'is_admin', condition: '=', value: '0' }

/**
 * 按「当前筛选结果」批量执行的操作。
 *
 * ⚠️ 这是整个用户管理里最危险的地方，值得把设计理由写下来：
 *
 * 后端的 ban / allDel / sendMail / dumpCSV 都是**按过滤条件**作用的，
 * 不接受 id 列表（UserController.php:305/328/281）。也就是说
 * **不带 filter 调用 allDel 会删掉全库用户**，连同他们的订单、邀请码、工单。
 * 后端也没有"按勾选行批量"的接口，所以前端做不到"只删勾选的几行"。
 *
 * 因此这里的设计原则是：
 *   1. 影响面必须显式写出来（多少个用户、什么条件），不让人凭感觉点确定；
 *   2. 无筛选条件时用最强的警告样式，因为那等于全库操作；
 *   3. 封禁和删除都要求手动输入数量确认 —— 删除不可恢复；封禁后端没有批量解封接口，
 *      误封一大片只能逐个编辑或改数据库，多一道摩擦是值得的；
 *   4. 后端的 ban / allDel 不区分管理员：条件一宽就会连当前管理员一起封掉
 *      （removeAllSession 立即踢下线，登录接口对 banned 用户直接拒绝），把所有人锁在后台外面。
 *      所以额外按「当前条件 + is_admin = 1」统计一次，命中时红字提示并默认追加 is_admin = 0；
 *   5. 请求超时 ≠ 没执行（后端是常驻进程，前端断开它照样跑完），超时后锁住确认按钮，
 *      让管理员先刷新确认，而不是原地重试造成重复群发。群发刷新列表看不出结果，
 *      这把锁还要跨弹窗保留（repeatGuard）：有效期内再打开，必须勾选「已核实」才能提交。
 */
export default function BulkActionModal({ action, ...rest }: Props) {
  if (!action) return null
  // 按 action 重新挂载：每次打开都从干净的状态开始（确认文字、排除管理员、当次的超时锁）。
  // 群发的超时记录不在组件状态里，见 repeatGuard
  return <BulkActionDialog key={action} action={action} {...rest} />
}

function BulkActionDialog({
  action,
  filters,
  onClose,
  onDone,
}: Omit<Props, 'action'> & { action: BulkAction }) {
  const meta = ACTION_META[action]
  const [submitting, setSubmitting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  // 条件里已经显式写了 is_admin（比如专门筛出管理员）就尊重这个意图，不默认排除
  const [excludeAdmins, setExcludeAdmins] = useState(
    () => !filters.some((f) => f.key === 'is_admin'),
  )
  const [outcomeUnknown, setOutcomeUnknown] = useState(false)
  // 上一次同类操作超时留下的记录：只在打开时读一次。有就必须先勾选「已核实」才能提交
  const [previous] = useState(() =>
    meta.repeatGuard
      ? recentUnknownOutcome<BulkOutcomeDetail>(meta.repeatGuard.kind)
      : null,
  )
  const [previousChecked, setPreviousChecked] = useState(false)
  const [mailForm] = Form.useForm<{ subject: string; content: string }>()

  const filtersKey = JSON.stringify(filters)

  /** 当前条件命中了多少个管理员。只有封禁 / 删除需要 */
  const adminScope = useQuery({
    queryKey: ['bulk-admin-scope', filtersKey],
    queryFn: () =>
      fetchUsers({ current: 1, pageSize: 10, filter: [...filters, ONLY_ADMINS] }),
    enabled: meta.guardAdmins,
    staleTime: 0,
    gcTime: 0,
  })
  const adminCount = adminScope.data?.total ?? 0
  const adminReady = !meta.guardAdmins || adminScope.isSuccess
  const excluding = meta.guardAdmins && excludeAdmins && adminCount > 0

  /** 真正提交给后端的条件。统计数量和执行必须用同一份 */
  const effectiveFilters = useMemo(
    () => (excluding ? [...filters, EXCLUDE_ADMINS] : filters),
    [excluding, filters],
  )

  /**
   * 影响数量在弹窗打开时**按当前条件重新查一次**，不复用表格的 total。
   *
   * 原因：用户可能改了筛选条件却没点「查询」，此时表格 total 还是旧条件的数字，
   * 而这里执行用的是新条件 —— 显示的数量和真实影响面就会不一致。
   * 确认数字必须和实际会被执行的条件来自同一次查询，所以等管理员统计出来、
   * 决定好是否排除管理员之后，再按最终条件数一次。
   */
  const scope = useQuery({
    queryKey: ['bulk-scope', action, JSON.stringify(effectiveFilters)],
    queryFn: () =>
      fetchUsers({
        current: 1,
        pageSize: 10,
        filter: effectiveFilters.length > 0 ? effectiveFilters : undefined,
      }),
    enabled: adminReady,
    // 每次打开都重新数，不吃缓存
    staleTime: 0,
    gcTime: 0,
  })

  const affectedCount = scope.data?.total ?? 0
  // 统计失败不能算「统计中」：否则管理员数量一查失败，scope 永远不会启用，
  // 弹窗就一直转圈、按钮一直写「正在统计」，也没有重试入口。
  // 查询失败后 isFetching 为 false，点重试时又变回 true，所以重试期间照样转圈。
  const countFailed = adminScope.isError || scope.isError
  const counting =
    adminScope.isFetching || scope.isFetching || (!countFailed && !scope.isSuccess)
  const isWholeDatabase = filters.length === 0
  // 数量还没查回来之前不允许提交，避免对着「0 个用户」点确定
  const confirmOk =
    !counting &&
    !outcomeUnknown &&
    (!previous || previousChecked) &&
    scope.isSuccess &&
    affectedCount > 0 &&
    (!meta.needTypedConfirm || confirmText.trim() === String(affectedCount))

  function handleCancel() {
    // 超时后关闭：刷新列表，让管理员看到后端实际执行到了哪一步
    if (outcomeUnknown) onDone()
    onClose()
  }

  async function handleOk() {
    let mail: { subject: string; content: string } | null = null
    if (action === 'sendMail') {
      try {
        mail = await mailForm.validateFields()
      } catch {
        return // 表单自己标红
      }
    }

    setSubmitting(true)
    try {
      if (action === 'ban') {
        await banUsersByFilter({ filter: effectiveFilters })
        message.success(`已封禁 ${affectedCount} 个用户`)
      } else if (action === 'allDel') {
        await deleteUsersByFilter({ filter: effectiveFilters })
        message.success(`已删除 ${affectedCount} 个用户`)
      } else if (mail) {
        await sendMailByFilter({
          filter: effectiveFilters,
          subject: mail.subject,
          content: mail.content,
        })
        message.success(`已提交群发任务，共 ${affectedCount} 个收件人`)
      }
      if (meta.repeatGuard) clearUnknownOutcome(meta.repeatGuard.kind)
      onDone()
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // 超时 / 断网：结果未知，锁住确认按钮（拦截器已弹出通用提示，这里给出针对本操作的说明）
        setOutcomeUnknown(true)
        // 当次锁关窗就没了；群发刷新列表又看不出结果，所以再记一笔，下次打开继续拦
        if (meta.repeatGuard) {
          rememberUnknownOutcome<BulkOutcomeDetail>(meta.repeatGuard.kind, {
            filters: effectiveFilters,
            count: affectedCount,
            subject: mail?.subject,
          })
        }
      }
      // 其他接口错误由 client.ts 拦截器统一弹出
    } finally {
      setSubmitting(false)
    }
  }

  function scopeMessage(): string {
    // 「执行发送邮件给」读起来别扭，群发单独换个说法（纯文案）
    const doWhat = action === 'sendMail' ? '发送邮件' : `执行${meta.verb}`
    // 没查成功之前 affectedCount 只是占位的 0，写成「将对全部 0 个用户…」会误导
    if (!scope.isSuccess) {
      return counting ? '正在统计影响范围…' : '影响范围尚未统计成功，暂不能执行'
    }
    if (isWholeDatabase) {
      return excluding
        ? `没有任何筛选条件 —— 将对除管理员外的全部 ${affectedCount} 个用户${doWhat}`
        : `没有任何筛选条件 —— 将对全部 ${affectedCount} 个用户${doWhat}`
    }
    return excluding
      ? `将对筛选命中的 ${affectedCount} 个用户（已排除管理员）${doWhat}`
      : `将对筛选命中的 ${affectedCount} 个用户${doWhat}`
  }

  const locked = submitting || outcomeUnknown
  const confirmMismatch =
    !!confirmText && confirmText.trim() !== String(affectedCount)

  return (
    <Modal
      open
      title={meta.title}
      onCancel={handleCancel}
      onOk={handleOk}
      confirmLoading={submitting}
      okButtonProps={{ danger: meta.danger, disabled: !confirmOk }}
      okText={
        outcomeUnknown
          ? '结果未知，请刷新确认'
          : counting
            ? '正在统计影响范围…'
            : !scope.isSuccess
              ? '统计失败，暂不能执行'
              : `确认${meta.verb} ${affectedCount} 个用户`
      }
      cancelText="取消"
      // 执行中不许关：关掉再打开就能重复提交，而前一个请求在后端还在跑
      closable={!submitting}
      keyboard={!submitting}
      cancelButtonProps={{ disabled: submitting }}
      width={640}
      destroyOnHidden
      maskClosable={false}
      // body 限高 100vh - 240 后弹窗最高约 100vh - 112（头 + 尾约 128px），top 56 让长弹窗上下各留 56px；
      // 默认 top 100 时底部只剩约 12px，遮罩还会多出一截滚动。不用 centered：切换内容时弹窗会上下跳
      style={{ top: 56 }}
      styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
    >
      <div className="user-page-stack">
        {outcomeUnknown && (
          <Alert
            type="error"
            showIcon
            message="请求超时：后端可能仍在执行，结果未知"
            description={meta.unknownHint}
          />
        )}

        {/* 当次又超时了就只看上面那条，不重复 */}
        {previous && meta.repeatGuard && !outcomeUnknown && (
          <Alert
            type="error"
            showIcon
            message={`上一次${meta.title}（${formatTime(Math.floor(previous.at / 1000))}）请求超时，结果未知`}
            description={
              <div className="user-page-alert-body">
                <p>{meta.repeatGuard.hint}</p>
                <div className="user-page-conds">
                  <span className="user-page-conds-label">上次</span>
                  {/* 提示框本身有底色，里面的标签带边框才认得出；危险靠图标和文字表达，不靠同色 */}
                  {previous.detail.subject && <Tag>主题：{previous.detail.subject}</Tag>}
                  <Tag>{previous.detail.count} 个用户</Tag>
                  {Array.isArray(previous.detail.filters) &&
                  previous.detail.filters.length > 0 ? (
                    previous.detail.filters.map((f, i) => <CondTag key={i} filter={f} />)
                  ) : (
                    <Tag icon={<ExclamationCircleOutlined />}>无筛选条件（全部用户）</Tag>
                  )}
                </div>
                <Checkbox
                  checked={previousChecked}
                  disabled={locked}
                  onChange={(e) => setPreviousChecked(e.target.checked)}
                >
                  我已核实上一次的实际结果，确认这次不是重复提交
                </Checkbox>
              </div>
            }
          />
        )}

        {submitting && (
          <Alert
            type="info"
            showIcon
            message="正在执行，用户多时可能需要几分钟，请不要关闭页面或重复操作"
          />
        )}
      </div>

      <Spin spinning={counting}>
        <div className="user-page-stack">
          <Alert
            type={isWholeDatabase ? 'error' : 'warning'}
            showIcon
            message={scopeMessage()}
            description={
              <div className="user-page-alert-body">
                <p>
                  这个操作作用于<strong>当前筛选结果</strong>，不是你在表格里勾选的行
                  —— 后端没有「按勾选行批量」的接口。
                </p>
                {effectiveFilters.length > 0 ? (
                  <div className="user-page-conds">
                    <span className="user-page-conds-label">当前条件</span>
                    {filters.map((f, i) => (
                      <CondTag key={i} filter={f} />
                    ))}
                    {excluding && (
                      <Tag color="success" className="user-page-cond">
                        <span className="mono">is_admin</span>
                        <span className="user-page-cond-op">=</span>
                        <strong>0</strong>
                        <span>（排除管理员）</span>
                      </Tag>
                    )}
                  </div>
                ) : null}
              </div>
            }
          />

          {countFailed && !counting && (
            <Alert
              type="error"
              showIcon
              message={
                adminScope.isError
                  ? '无法统计当前条件命中的管理员数量'
                  : '无法统计当前条件命中的用户数量'
              }
              description={
                adminScope.isError
                  ? '为避免误伤管理员账号，统计成功之前不允许执行。'
                  : '确认数字必须来自实际执行的条件，统计成功之前不允许执行。'
              }
              action={
                <Button
                  size="small"
                  onClick={() =>
                    // 管理员统计失败时 scope 根本没启用，重试它就够了：成功后 scope 自动开始
                    void (adminScope.isError ? adminScope.refetch() : scope.refetch())
                  }
                >
                  重试
                </Button>
              }
            />
          )}

          {meta.guardAdmins && adminCount > 0 && (
            <Alert
              type="error"
              showIcon
              message={`当前条件命中了 ${adminCount} 个管理员账号（可能包括你自己）`}
              description={
                <div className="user-page-alert-body">
                  <p>
                    {action === 'ban'
                      ? '被封禁的管理员会立即被踢下线，而且无法再登录后台；后端没有批量解封接口，如果所有管理员都被封禁，只能直接改数据库恢复。'
                      : '管理员账号会和普通用户一样被删除且不可恢复；如果当前登录的管理员也在其中，会立即失去后台访问。'}
                  </p>
                  <Checkbox
                    checked={excludeAdmins}
                    disabled={locked}
                    onChange={(e) => {
                      setExcludeAdmins(e.target.checked)
                      // 影响数量会变，之前输入的确认数字作废
                      setConfirmText('')
                    }}
                  >
                    排除管理员账号（执行时追加条件 is_admin = 0）
                  </Checkbox>
                </div>
              }
            />
          )}

          {action === 'allDel' && (
            <Alert
              type="error"
              showIcon
              message="删除不可恢复"
              description="除用户本身外，还会一并删除他们的订单、邀请码、工单及工单消息，并解除其他用户对他们的邀请关系。"
            />
          )}

          {action === 'ban' && (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              封禁会同时踢掉这些用户的全部登录会话，他们的订阅将立即不可用。后端没有批量解封接口。
            </Typography.Text>
          )}
        </div>

        {action === 'sendMail' && (
          <Form form={mailForm} layout="vertical" disabled={locked}>
            <Form.Item
              name="subject"
              label="邮件主题"
              rules={[{ required: true, whitespace: true, message: '请输入主题' }]}
            >
              <Input placeholder="例如：服务维护通知" />
            </Form.Item>
            <Form.Item
              name="content"
              label="邮件内容"
              rules={[{ required: true, whitespace: true, message: '请输入内容' }]}
              extra="使用 notify 邮件模板发送，走 send_email_mass 队列，需要队列进程在运行"
            >
              <Input.TextArea autoSize={{ minRows: 6, maxRows: 12 }} placeholder="支持 HTML" />
            </Form.Item>
          </Form>
        )}

        {meta.needTypedConfirm && (
          <Form layout="vertical" disabled={locked}>
            <Form.Item
              label={
                <span>
                  输入将被{meta.verb}的用户数量
                  <span className="user-page-confirm-num">
                    {scope.isSuccess ? affectedCount : '—'}
                  </span>
                  以确认
                </span>
              }
              validateStatus={confirmMismatch ? 'error' : undefined}
              help={confirmMismatch ? '数量不匹配' : undefined}
            >
              <Input
                className="user-page-confirm-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={scope.isSuccess ? String(affectedCount) : ''}
                autoComplete="off"
                inputMode="numeric"
              />
            </Form.Item>
          </Form>
        )}
      </Spin>
    </Modal>
  )
}

/** 一条过滤条件：字段名（等宽） 比较符 值 */
function CondTag({ filter }: { filter: UserFilter }) {
  return (
    <Tag color="processing" className="user-page-cond">
      <span className="mono">{filter.key}</span>
      <span className="user-page-cond-op">{filter.condition}</span>
      <strong>{String(filter.value)}</strong>
    </Tag>
  )
}
