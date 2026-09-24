import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Grid,
  Input,
  InputNumber,
  Modal,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
  type ColProps,
} from 'antd'
import {
  ApiOutlined,
  CloseCircleFilled,
  CloudServerOutlined,
  CustomerServiceOutlined,
  ExclamationCircleFilled,
  GlobalOutlined,
  LaptopOutlined,
  MailOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SendOutlined,
  SettingOutlined,
  ShareAltOutlined,
  SkinOutlined,
  SyncOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import FormSection from '@/components/FormSection'
import SettingSwitch from '@/components/SettingSwitch'
import { ApiError } from '@/api/client'
import {
  fetchConfig,
  fetchEmailTemplates,
  fetchThemeTemplates,
  saveConfig,
  setTelegramWebhook,
  testSendMail,
} from '@/api/config'
import { adminApiBase, securePath } from '@/settings'
import {
  CONFIG_GROUPS,
  DECLARED_FIELDS,
  FIELD_GROUP,
  JSON_FIELDS,
  SWITCH_FIELDS,
  stripEmptyTiers,
  TAG_FIELDS,
  type ConfigField,
} from './configSchema'
import './ConfigPage.css'

type Values = Record<string, any>

const GROUP_ICONS: Record<string, ReactNode> = {
  site: <GlobalOutlined />,
  safe: <SafetyCertificateOutlined />,
  subscribe: <SyncOutlined />,
  invite: <ShareAltOutlined />,
  server: <CloudServerOutlined />,
  email: <MailOutlined />,
  telegram: <SendOutlined />,
  frontend: <SkinOutlined />,
  ticket: <CustomerServiceOutlined />,
  deposit: <WalletOutlined />,
  app: <LaptopOutlined />,
}

/**
 * 输入类字段的列宽：宽屏按 schema 的 span，窄屏折成整行。
 * 8 / 16 在 sm 以上就保持（「版本号 + 下载地址」、三个一排的小数值），12 到 md 才两两并排。
 */
function colProps(span = 24): ColProps {
  if (span >= 24) return { span: 24 }
  if (span === 12) return { xs: 24, md: 12 }
  return { xs: 24, sm: span }
}

/**
 * 同一排开关卡片的列数不按视口断点，而按分组卡片自己的宽度（ConfigPage.css 里的容器查询）：
 * 有侧边栏又有分组导航时（例如 1024 宽），内容列只剩 500 多 px，按视口算的两列会把说明挤成三四行。
 * 这里只标出这一排有几个开关，列数交给 CSS。
 */
function switchRunClass(count: number) {
  return `config-page-switches ${count === 1 ? 'is-1' : count === 3 ? 'is-3' : 'is-2'}`
}

interface Section {
  title?: string
  description?: string
  fields: ConfigField[]
}

/** 按 schema 里的 section 标记切小节；没有标记的分组就是一个无标题小节 */
function splitSections(fields: ConfigField[]): Section[] {
  const sections: Section[] = []
  for (const field of fields) {
    const last = sections[sections.length - 1]
    if (field.section || !last) {
      sections.push({ ...field.section, fields: [field] })
    } else {
      last.fields.push(field)
    }
  }
  return sections
}

/**
 * 把一个小节里的字段按「开关 / 其它」切成连续的几排，开关和输入框不混在同一个 Row 里。
 * 只切不重排：页面上的字段顺序与 schema 完全一致（firstInPageOrder 依赖这一点）。
 */
function splitRuns(fields: ConfigField[]): { switches: boolean; fields: ConfigField[] }[] {
  const runs: { switches: boolean; fields: ConfigField[] }[] = []
  for (const field of fields) {
    const switches = field.type === 'switch'
    const last = runs[runs.length - 1]
    if (last && last.switches === switches) last.fields.push(field)
    else runs.push({ switches, fields: [field] })
  }
  return runs
}

const GROUP_SECTIONS = new Map(CONFIG_GROUPS.map((g) => [g.key, splitSections(g.fields)]))

/** label 旁的小标记。都是 bordered={false} 的小号 Tag，不会把 label 撑高 */
function FieldLabel({ field }: { field: ConfigField }) {
  return (
    <span className="config-page-label">
      <span>{field.label}</span>
      {field.dangerous && (
        <Tag bordered={false} color="error" className="config-page-flag">
          影响面大
        </Tag>
      )}
      {field.writeOnly && (
        <Tag bordered={false} color="warning" className="config-page-flag">
          不回显
        </Tag>
      )}
      {field.readonly && (
        <Tag bordered={false} className="config-page-flag">
          只读
        </Tag>
      )}
    </span>
  )
}

/** 结果页里的命令块：等宽、可复制，颜色跟随主题 */
function CommandBlock({ lines, copyText }: { lines: string[]; copyText: string }) {
  return (
    <div className="config-page-cmd">
      <pre className="code-block">{lines.join('\n')}</pre>
      <Typography.Text
        className="config-page-cmd-copy"
        copyable={{ text: copyText, tooltips: ['复制命令', '已复制'] }}
      />
    </div>
  )
}

/** 保存后等后端重启回来 */
async function waitForBackend(timeoutMs = 60_000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      // 用任意一个轻量管理接口探活；403 也算「活着」（说明能路由到 PHP）
      const res = await fetch(`${adminApiBase}/config/fetch?key=ticket`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      if (res.status < 500) return true
    } catch {
      // 连接不上，继续等
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

export default function ConfigPage() {
  const qc = useQueryClient()
  const [form] = Form.useForm<Values>()
  const [saving, setSaving] = useState(false)
  /**
   * 保存后的处置状态：
   *   waiting  正在等后端（若它真的重启了）
   *   applied  保存并生效
   *   written  文件已写入但未生效（Workerman 下的已知后端 bug）
   *   down     后端没回来
   */
  const [outcome, setOutcome] = useState<
    'waiting' | 'applied' | 'written' | 'down' | null
  >(null)
  /** 受控的标签页：校验失败时要切到出错字段所在的那一页 */
  const [activeTab, setActiveTab] = useState(CONFIG_GROUPS[0]?.key ?? '')
  /**
   * 表单是否已经用 config/fetch 的结果回填过。
   * 没回填时表单里全是 undefined，以前的 buildPayload 会把所有开关写成 0、
   * 把 deposit_bounus 写成 []，后端 in:0,1 照单全收并落盘 —— 注册重新开放、
   * 人机/邮箱验证与密码错误锁定全部失效、关闭的提现被重新打开。
   */
  const [populated, setPopulated] = useState(false)
  /**
   * 未保存修改的提示（只用于展示，不参与提交 —— 提交永远取整个 store）。
   * baseline 是最近一次回填的值；值改回原样、或被清成 undefined（buildPayload 会跳过）都不算修改。
   */
  const baseline = useRef<Values>({})
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set())
  const screens = Grid.useBreakpoint()
  const compact = screens.lg === false
  /** 手机宽度：「重新读取」只留图标，保存栏保持一行 */
  const narrow = screens.sm === false
  const [testingMail, setTestingMail] = useState(false)
  const [settingWebhook, setSettingWebhook] = useState(false)

  const [configQuery, emailTplQuery, themeTplQuery] = useQueries({
    queries: [
      { queryKey: ['config'], queryFn: fetchConfig },
      { queryKey: ['email-templates'], queryFn: fetchEmailTemplates },
      { queryKey: ['theme-templates'], queryFn: fetchThemeTemplates },
    ],
  })

  const config = configQuery.data

  /** 后端返回了但 schema 没声明的字段 —— 提示出来，避免静默遗漏 */
  const undeclared = useMemo(() => {
    if (!config) return []
    const all: string[] = []
    for (const group of Object.values(config)) {
      for (const key of Object.keys(group)) {
        if (!DECLARED_FIELDS.has(key)) all.push(key)
      }
    }
    return all
  }, [config])

  useEffect(() => {
    if (!config) return
    const flat: Values = {}
    for (const group of Object.values(config)) {
      for (const [key, value] of Object.entries(group)) {
        if (SWITCH_FIELDS.has(key)) {
          flat[key] = value === 1 || value === '1' || value === true
        } else if (TAG_FIELDS.has(key)) {
          flat[key] = Array.isArray(value) ? value : []
        } else if (JSON_FIELDS.has(key)) {
          // 线上常见的 [null]（原版后台的「不赠送」）剔除空项后就是空，回填成空文本域
          const cleaned = Array.isArray(value) ? stripEmptyTiers(value) : value
          flat[key] =
            cleaned === null || cleaned === undefined
              ? ''
              : typeof cleaned === 'string'
                ? cleaned
                : Array.isArray(cleaned) && cleaned.length === 0
                  ? ''
                  : JSON.stringify(cleaned, null, 2)
        } else {
          flat[key] = value ?? undefined
        }
      }
    }
    form.setFieldsValue(flat)
    baseline.current = flat
    // 回填覆盖到的字段恢复成线上值；fetch 不回显的字段（try_out_enable 等）不会被覆盖，改动仍在
    setDirty((prev) => new Set([...prev].filter((name) => !(name in flat))))
    setPopulated(true)
  }, [config, form])

  function trackDirty(changed: Values) {
    setDirty((prev) => {
      const next = new Set(prev)
      for (const [name, value] of Object.entries(changed)) {
        const same = JSON.stringify(value) === JSON.stringify(baseline.current[name])
        if (value === undefined || same) next.delete(name)
        else next.add(name)
      }
      return next
    })
  }

  const dirtyGroups = useMemo(
    () => new Set([...dirty].map((name) => FIELD_GROUP.get(name))),
    [dirty],
  )

  /** 有校验错误的分组，在导航上标红点（setFields 不触发 onFieldsChange，挂 422 错误后要手动刷新） */
  const [errorGroups, setErrorGroups] = useState<ReadonlySet<string | undefined>>(() => new Set())
  function refreshErrorGroups() {
    const next = new Set(
      form
        .getFieldsError()
        .filter((f) => f.errors.length > 0)
        .map((f) => FIELD_GROUP.get(String(f.name[0]))),
    )
    setErrorGroups((prev) =>
      prev.size === next.size && [...next].every((g) => prev.has(g)) ? prev : next,
    )
  }

  /**
   * 只有「最近一次读取成功」且「表单已回填」才允许保存。
   * 读取失败（Workerman 重启窗口里的 502/500、超时…；QueryClient 设了 retry:false，
   * 不会自动重试）时表单里不是线上的当前值，这时保存等于拿它覆盖线上配置。
   * 「重新读取」失败（isError 但还留着旧数据）也一样禁用，要求先读成功。
   */
  const canSave = configQuery.isSuccess && populated && !configQuery.isFetching

  /** 切到字段所在的标签页并滚过去。flushSync：先让标签页切出来，隐藏面板里的元素滚不过去 */
  function focusField(name: string) {
    const group = FIELD_GROUP.get(name)
    if (group) flushSync(() => setActiveTab(group))
    form.scrollToField(name, { block: 'center' })
  }

  /** 按页面上的字段顺序取第一个出错的字段，保证每次跳到的是同一个 */
  function firstInPageOrder(names: Set<string>): string | undefined {
    return [...DECLARED_FIELDS].find((n) => names.has(n))
  }

  /**
   * 把 config/save 的 422 逐字段落到表单上。
   * 后端的错误键是 Laravel 的属性名：一般就是字段名；数组元素的错误可能是
   * `deposit_bounus.0` 这种，归到顶层字段。schema 没声明的键汇总成提示，不能丢。
   */
  function showSaveFieldErrors(error: ApiError) {
    const byField = new Map<string, string[]>()
    const orphan: string[] = []
    for (const [key, errors] of Object.entries(error.fieldErrors ?? {})) {
      const name = key.split('.')[0] ?? key
      if (FIELD_GROUP.has(name)) {
        byField.set(name, [...(byField.get(name) ?? []), ...errors])
      } else {
        orphan.push(...errors)
      }
    }

    if (byField.size > 0) {
      form.setFields([...byField].map(([name, errors]) => ({ name, errors })))
      refreshErrorGroups()
      const first = firstInPageOrder(new Set(byField.keys()))
      if (first) focusField(first)
    }

    // ConfigSave 是整单校验：一个字段不合法，本次提交的所有改动都没有写入。
    // 必须说清楚，否则管理员会以为同一次改的安全开关已经生效了。
    if (byField.size > 0) {
      message.error(
        `后端校验未通过（${byField.size} 个字段），本次所有改动都没有写入，请按字段提示修改后重新保存`,
      )
      if (orphan.length > 0) message.error(orphan.join('；'))
    } else {
      message.error(
        `后端校验未通过，本次所有改动都没有写入：${orphan.join('；') || error.message}`,
      )
    }
  }

  function optionsFor(field: ConfigField) {
    if (field.name === 'email_template') {
      return (emailTplQuery.data ?? []).map((t) => ({ value: t, label: t }))
    }
    if (field.name === 'frontend_theme') {
      return (themeTplQuery.data ?? []).map((t) => ({ value: t, label: t }))
    }
    return field.options
  }

  function renderControl(field: ConfigField): ReactNode {
    switch (field.type) {
      case 'number':
        return (
          <InputNumber
            style={{ width: '100%' }}
            disabled={field.readonly}
            suffix={field.unit}
            placeholder={field.placeholder}
          />
        )
      case 'select':
        return (
          <Select
            allowClear
            style={{ width: '100%' }}
            disabled={field.readonly}
            options={optionsFor(field)}
            placeholder={field.placeholder ?? '未设置'}
          />
        )
      case 'password':
        return (
          <Input.Password
            disabled={field.readonly}
            autoComplete="off"
            placeholder={field.placeholder}
          />
        )
      case 'tags':
        return (
          <Select
            mode="tags"
            style={{ width: '100%' }}
            disabled={field.readonly}
            tokenSeparators={[',', ' ']}
            placeholder={field.placeholder ?? '输入后回车添加'}
            notFoundContent={null}
          />
        )
      case 'json':
        return (
          <Input.TextArea
            autoSize={{ minRows: 4, maxRows: 12 }}
            className="mono"
            disabled={field.readonly}
            placeholder={field.placeholder}
          />
        )
      case 'textarea':
        return (
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 10 }}
            disabled={field.readonly}
            placeholder={field.placeholder}
          />
        )
      default:
        return <Input disabled={field.readonly} placeholder={field.placeholder} />
    }
  }

  /** 这个字段在当前断点下是否独占一行（与 colProps 的断点一致） */
  function isFullRow(span = 24) {
    if (span >= 24 || screens.sm === false) return true
    return span === 12 && screens.md === false
  }

  /**
   * 输入类字段。help：独占一行时放在下方（extra），和别的字段并排时放进 label 旁的问号，
   * 同一行高度一致。窄屏上半宽字段也折成整行了，这时同样放在下方，触屏上不用去点小问号。
   */
  function renderInput(field: ConfigField) {
    const helpAs = field.help
      ? isFullRow(field.span)
        ? 'extra'
        : (field.helpAs ?? 'tooltip')
      : undefined
    return (
      <Col {...colProps(field.span)} key={field.name}>
        <Form.Item
          name={field.name}
          label={<FieldLabel field={field} />}
          tooltip={helpAs === 'tooltip' ? field.help : undefined}
          extra={helpAs === 'extra' ? field.help : undefined}
          rules={field.rules}
        >
          {renderControl(field)}
        </Form.Item>
      </Col>
    )
  }

  /** 开关字段：SettingSwitch 卡片（标题 + help 作说明），同一排等高 */
  function renderSwitch(field: ConfigField) {
    return (
      <div className="config-page-switch-cell" key={field.name}>
        <SettingSwitch
          name={field.name}
          title={<FieldLabel field={field} />}
          description={field.help}
          // 显式传 true 才有禁用样式；其余情况传 undefined，交给 Form 的 disabled（没回填时整表禁用）
          disabled={field.readonly || !populated ? true : undefined}
        />
      </div>
    )
  }

  function renderSection(section: Section, index: number) {
    const rows = splitRuns(section.fields).map((run) =>
      run.switches ? (
        <div className={switchRunClass(run.fields.length)} key={run.fields[0]?.name}>
          {run.fields.map(renderSwitch)}
        </div>
      ) : (
        <Row gutter={16} key={run.fields[0]?.name}>
          {run.fields.map(renderInput)}
        </Row>
      ),
    )
    if (!section.title) return <div key={index}>{rows}</div>
    return (
      <FormSection
        key={section.title}
        title={section.title}
        description={section.description}
        extra={sectionAction(section)}
        first={index === 0}
      >
        {rows}
      </FormSection>
    )
  }

  /** 小节标题右侧的动作：放在它要用到的字段旁边 */
  function sectionAction(section: Section): ReactNode {
    if (section.fields.some((f) => f.name === 'telegram_bot_token')) {
      return (
        <Tooltip title="用下方填写的 Bot Token（不必先保存）向 Telegram 注册 Webhook">
          <Button
            size="small"
            icon={<ApiOutlined />}
            loading={settingWebhook}
            onClick={async () => {
              const token = form.getFieldValue('telegram_bot_token')
              if (!token) {
                message.warning('请先填写 Bot Token')
                return
              }
              setSettingWebhook(true)
              try {
                await setTelegramWebhook(token)
                message.success('Webhook 已设置')
              } finally {
                setSettingWebhook(false)
              }
            }}
          >
            设置 Webhook
          </Button>
        </Tooltip>
      )
    }
    return null
  }

  /** 分组卡片右上角的动作 */
  function groupAction(key: string): ReactNode {
    if (key === 'email') {
      return (
        <Tooltip title="使用已保存并生效的 SMTP 配置发送；刚改的配置要先保存生效">
          <Button
            icon={<SendOutlined />}
            loading={testingMail}
            onClick={async () => {
              setTestingMail(true)
              try {
                await testSendMail()
                message.success(
                  '测试邮件已发送到当前管理员邮箱，请查收（失败原因会在响应的 log 字段里）',
                )
              } finally {
                setTestingMail(false)
              }
            }}
          >
            发送测试邮件
          </Button>
        </Tooltip>
      )
    }
    return null
  }

  function buildPayload(values: Values): Values {
    const payload: Values = {}
    for (const group of CONFIG_GROUPS) {
      for (const field of group.fields) {
        if (field.readonly) continue
        const raw = values[field.name]
        // undefined = 既没从 fetch 回填、也没被改过（fetch 不回显的 try_out_enable 就是这样，
        // 或者某个分组没返回）。**跳过，不要替它编一个值**：save 对缺失的键保留旧值，
        // 而把 undefined 强转成 0 / [] 会静默关掉线上的开关、清空充值赠送阶梯。
        if (raw === undefined) continue
        // secure_path 没改就不提交：ConfigSave 对它是 min:8 且整单校验，线上现存的路径若不满足
        // （例如沿用旧版 frontend_admin_path），每次保存都会 422，其它改动全部写不进去。
        // 不提交时后端保留原值，与提交原值等价。
        if (field.name === 'secure_path' && raw === securePath) continue
        if (SWITCH_FIELDS.has(field.name)) {
          // 后端是 in:0,1，传 true/false 会 422
          payload[field.name] = raw ? 1 : 0
        } else if (JSON_FIELDS.has(field.name)) {
          if (typeof raw === 'string' && raw.trim() !== '') {
            const parsed: unknown = JSON.parse(raw)
            payload[field.name] = Array.isArray(parsed) ? stripEmptyTiers(parsed) : parsed
          } else {
            // 回填过、被管理员清空（或线上本来就是空）才会走到这里 —— 这是明确的「不赠送」
            payload[field.name] = []
          }
        } else {
          payload[field.name] = raw
        }
      }
    }
    return payload
  }

  async function doSave() {
    // 按钮已禁用，这里再兜一次：没拿到线上值就绝不提交
    if (!canSave) return
    // 取整个 store（getFieldsValue(true)），不要用不带参数的 getFieldsValue()：
    // 后者只返回「已挂载」的 Form.Item，而 Tabs 默认不渲染没点开过的标签页，
    // 于是只改了「站点」就保存时，安全/邀请等页的开关全是 undefined。
    // 现在 Tabs 已 forceRender，这里仍取整个 store，双保险。
    const values = form.getFieldsValue(true) as Values
    let payload: Values
    try {
      payload = buildPayload(values)
    } catch {
      message.error('充值赠送阶梯不是合法的 JSON')
      return
    }

    const newSecurePath = payload['secure_path']
    const securePathChanged =
      typeof newSecurePath === 'string' && newSecurePath !== securePath

    setSaving(true)
    setOutcome('waiting')
    try {
      // 可能的结果：成功 / 4xx（一定没写入）/ 后端自杀导致连接中断或超时 /
      // Workerman 下 config:cache 异常的 500
      let saveFailed = false
      try {
        await saveConfig(payload, { handle422: true })
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          // 4xx 都发生在进控制器之前（ConfigSave 校验、Admin 中间件、路由、限流），文件一定没写。
          // 绝不能走下面「探活 → written」：422 时后端根本没重启，探活必然秒回，
          // 以前就是这样把校验失败谎报成「已写入未生效」、还让管理员去服务器执行命令的。
          setOutcome(null)
          if (error.status === 422) showSaveFieldErrors(error)
          // 403 拦截器已跳登录页；其余 4xx 拦截器已弹出后端 message
          return
        }
        if (error instanceof ApiError && error.status === 500 && error.message === '修改失败') {
          // ConfigController::save 里 File::put 失败时的 abort(500,'修改失败')，
          // 是唯一能确定「没写入」的 500；其它 500 都可能发生在写文件之后
          setOutcome(null)
          message.error(
            '配置文件 config/v2board.php 写入失败（通常是文件权限问题），本次改动没有保存',
          )
          return
        }
        // 没有响应（断连/超时，status 0）或其它 5xx：后端可能已经写了文件，走探活
        saveFailed = true
      }

      const back = await waitForBackend()
      if (!back) {
        setOutcome('down')
        return
      }

      if (saveFailed) {
        // 文件在 opcache/config:cache 之前就写好了，所以「请求失败」≠「没写入」。
        // 这里不谎报成功，也不谎报失败 —— 明确告诉用户当前处于「已写入未生效」。
        setOutcome('written')
        return
      }

      setOutcome('applied')
      // 只影响「未保存修改」的提示：刚提交的值就是新的基线
      baseline.current = { ...baseline.current, ...values }
      setDirty(new Set())
      qc.invalidateQueries({ queryKey: ['config'] })
      if (securePathChanged) {
        Modal.warning({
          title: '后台路径已更改',
          content: `新的后台入口是 /${newSecurePath}/v2 ，当前地址已失效。请重新访问新地址并重新登录。`,
          okText: '前往新地址',
          onOk: () => {
            window.location.assign(`/${newSecurePath}/v2`)
          },
        })
      } else {
        message.success('配置已保存并生效')
      }
    } finally {
      setSaving(false)
    }
  }

  async function confirmSave() {
    if (!canSave) return
    try {
      // 各标签页都 forceRender 了，validateFields 能覆盖全部字段，不只是当前页
      await form.validateFields()
    } catch (e) {
      const errorFields =
        (e as { errorFields?: { name: (string | number)[] }[] }).errorFields ?? []
      const names = new Set(errorFields.map((f) => String(f.name[0])))
      const first = firstInPageOrder(names)
      if (first) focusField(first)
      message.error(
        names.size > 0
          ? `有 ${names.size} 个字段未通过校验，请按提示修改后再保存`
          : '表单校验失败，请检查后再保存',
      )
      return
    }

    Modal.confirm({
      title: '保存配置需要在服务器上补一步',
      icon: <ExclamationCircleFilled />,
      width: 640,
      content: (
        <Flex vertical gap={12} className="config-page-confirm">
          <span>
            后端会先把配置写进 <Typography.Text code>config/v2board.php</Typography.Text>，
            然后调 <Typography.Text code>config:cache</Typography.Text> 重建缓存并重启进程。
          </span>
          <Alert
            type="error"
            message={
              // 红框已经足够醒目，正文用常规色加粗：暗色下红字压在红底上看不清
              <Typography.Text strong>
                但在 Workerman 常驻模式下第二步会抛异常（AdapterMan 不提供
                $_SERVER['PHP_SELF']，Symfony Console 构造时就崩了）——
                结果是文件写进去了、新配置却不生效。
              </Typography.Text>
            }
          />
          <Typography.Text type="secondary">
            所以保存后大概率会提示「已写入未生效」，届时按提示在服务器上执行两条命令即可。
            本页会自动探活并给出后续步骤。
          </Typography.Text>
        </Flex>
      ),
      okText: '我了解，继续保存',
      cancelText: '取消',
      onOk: doSave,
    })
  }

  if (outcome === 'down') {
    return (
      <Card className="config-page-outcome">
        <Result
          status="warning"
          title="后端在 60 秒内没有恢复"
          subTitle="配置很可能已经写入成功，但 Workerman 没有被重新拉起。请登录服务器执行下面的命令，然后刷新本页。"
          extra={
            <div className="config-page-outcome-body">
              <CommandBlock
                lines={['php -c cli-php.ini webman.php start -d']}
                copyText="php -c cli-php.ini webman.php start -d"
              />
              <div className="config-page-outcome-actions">
                <Button type="primary" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
                  重新加载
                </Button>
              </div>
            </div>
          }
        />
      </Card>
    )
  }

  if (outcome === 'written') {
    return (
      <Card className="config-page-outcome">
        <Result
          status="info"
          title="配置已写入文件，但尚未生效"
          subTitle="这是后端在 Workerman 模式下的已知问题：写文件成功，但重建配置缓存那一步抛异常，所以进程仍在用旧配置。"
          extra={
            <div className="config-page-outcome-body">
              <Typography.Text>
                在服务器上先进入面板所在目录，再执行这两条命令即可让配置生效：
              </Typography.Text>
              {/* 复制出来的就是看到的这两条（用 && 连成一行），不再带占位的 cd 路径 */}
              <CommandBlock
                lines={[
                  'php artisan config:cache',
                  'php -c cli-php.ini webman.php stop && php -c cli-php.ini webman.php start -d',
                ]}
                copyText={
                  'php artisan config:cache && ' +
                  'php -c cli-php.ini webman.php stop && ' +
                  'php -c cli-php.ini webman.php start -d'
                }
              />
              <Typography.Text type="secondary" className="config-page-outcome-note">
                注意第二条会让面板短暂中断。执行完刷新本页确认新值已生效。
              </Typography.Text>
              <div className="config-page-outcome-actions">
                <Button type="primary" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
                  我已执行，重新加载
                </Button>
              </div>
            </div>
          }
        />
      </Card>
    )
  }

  const reload = () => qc.invalidateQueries({ queryKey: ['config'] })

  let status: ReactNode
  if (configQuery.isError) {
    status = (
      <span className="config-page-savebar-state is-error">
        <CloseCircleFilled />
        读取失败，已禁止保存
      </span>
    )
  } else if (!populated) {
    status = <span className="config-page-savebar-state">正在读取线上配置…</span>
  } else if (errorGroups.size > 0) {
    status = (
      <span className="config-page-savebar-state is-error">
        <CloseCircleFilled />
        <span className="tabular-nums">{errorGroups.size}</span> 个分组有字段未通过校验
      </span>
    )
  } else if (dirty.size > 0) {
    status = (
      <span className="config-page-savebar-state is-dirty">
        <span className="config-page-dot" />
        <span className="tabular-nums">{dirty.size}</span> 项修改未保存
      </span>
    )
  } else {
    status = <span className="config-page-savebar-state">没有未保存的修改</span>
  }

  const saveBar = (
    <div className="config-page-savebar">
      <div className="config-page-savebar-status">
        {status}
        <span className="config-page-savebar-hint">
          保存后需在服务器上补执行 config:cache 才生效
        </span>
      </div>
      <Space size={8} className="config-page-savebar-actions">
        <Tooltip title={narrow ? '重新读取' : undefined}>
          {/* 保存栏在 <Form disabled={!populated}> 里，显式 disabled={false}：首次读取失败时恰恰要靠它重试 */}
          <Button
            icon={<ReloadOutlined />}
            onClick={reload}
            aria-label="重新读取"
            disabled={false}
          >
            {narrow ? null : '重新读取'}
          </Button>
        </Tooltip>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!canSave}
          onClick={confirmSave}
        >
          保存
        </Button>
      </Space>
    </div>
  )

  return (
    <Spin
      spinning={configQuery.isFetching || saving}
      tip={outcome === 'waiting' ? '正在确认后端状态…' : undefined}
    >
      <Flex vertical gap={16} className="config-page">
        {configQuery.isError && (
          <Alert
            type="error"
            showIcon
            message="读取系统配置失败，已禁止保存"
            description={
              `${configQuery.error.message}。` +
              (populated
                ? '表单里可能不是线上的最新值，请重新读取成功后再保存。'
                : '表单里没有线上的当前值，此时保存会把所有开关写成关闭、清空充值赠送阶梯。请重新读取成功后再修改。')
            }
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
                重新读取
              </Button>
            }
          />
        )}

        {undeclared.length > 0 && (
          <Alert
            type="info"
            showIcon
            message={`后端还返回了 ${undeclared.length} 个本页未收录的字段`}
            description={
              <>
                <div className="config-page-alert-text">
                  这些字段在 config/fetch 里出现，但本页 schema 未声明 ——
                  它们要么是只读派生值，要么是新增字段。保存时不会被改动。
                </div>
                <Space size={4} wrap>
                  {undeclared.map((k) => (
                    <Tag key={k} bordered={false} className="mono">
                      {k}
                    </Tag>
                  ))}
                </Space>
              </>
            }
          />
        )}

        {/* 没回填前整个表单禁用：空表单上的「关闭」开关不是线上的真实状态，不能让人在上面改 */}
        <Form<Values>
          form={form}
          layout="vertical"
          disabled={!populated}
          // 后端 422 用 setFields 挂上的错误，对没有前端 rules 的字段不会自动消失；
          // 字段一改就清掉，免得改对了还挂着旧红字
          onValuesChange={(changed) => {
            // 只清真的挂着错误的字段：对没有错误的字段也 setFields(errors: [])，rc-field-form 比较 meta 时
            // errors 和 warnings 是同一个空数组，开发环境会误报「There may be circular references」
            const withErrors = Object.keys(changed).filter(
              (name) => form.getFieldError(name).length > 0,
            )
            if (withErrors.length > 0) {
              form.setFields(withErrors.map((name) => ({ name, errors: [] })))
            }
            trackDirty(changed)
            refreshErrorGroups()
          }}
          // 前端 rules 的校验结果（含 validateFields）从这里进来
          onFieldsChange={refreshErrorGroups}
        >
          <Tabs
            className="config-page-tabs"
            popupClassName="config-page-tabs-popup"
            tabPosition={compact ? 'top' : 'left'}
            activeKey={activeTab}
            onChange={setActiveTab}
            items={CONFIG_GROUPS.map((group) => ({
              key: group.key,
              label: (
                <span className="config-page-tab">
                  <span className="config-page-tab-icon">
                    {GROUP_ICONS[group.key] ?? <SettingOutlined />}
                  </span>
                  <span className="config-page-tab-text">{group.title}</span>
                  {errorGroups.has(group.key) ? (
                    <span className="config-page-dot is-error" title="有字段未通过校验" />
                  ) : (
                    dirtyGroups.has(group.key) && (
                      <span className="config-page-dot" title="有未保存的修改" />
                    )
                  )}
                </span>
              ),
              // 必须 forceRender：Tabs 默认不渲染没点开过的面板，里面的 Form.Item 不注册，
              // validateFields 校验不到、setFields 的 422 错误也挂不上去
              forceRender: true,
              children: (
                <>
                  <Card
                    className="config-page-group"
                    title={
                      <div className="config-page-group-head">
                        <span className="config-page-group-icon">
                          {GROUP_ICONS[group.key] ?? <SettingOutlined />}
                        </span>
                        <div className="config-page-group-titles">
                          <div className="config-page-group-title">{group.title}</div>
                          {group.description && group.descriptionTone !== 'warning' && (
                            <div className="config-page-group-desc">{group.description}</div>
                          )}
                        </div>
                      </div>
                    }
                    extra={groupAction(group.key)}
                  >
                    {group.description && group.descriptionTone === 'warning' && (
                      <Alert
                        className="config-page-group-alert"
                        type="warning"
                        showIcon
                        message={group.description}
                      />
                    )}
                    {(GROUP_SECTIONS.get(group.key) ?? []).map(renderSection)}
                  </Card>
                  {/* 保存栏只挂在当前分组下面：紧跟卡片，字段少的分组也不会隔着导航的高度 */}
                  {group.key === activeTab && saveBar}
                </>
              ),
            }))}
          />
        </Form>

      </Flex>
    </Spin>
  )
}
