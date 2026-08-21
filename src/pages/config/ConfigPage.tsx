import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ExclamationCircleFilled,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { useQueries, useQueryClient } from '@tanstack/react-query'
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
  JSON_FIELDS,
  SWITCH_FIELDS,
  TAG_FIELDS,
  type ConfigField,
} from './configSchema'

type Values = Record<string, any>

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
          flat[key] =
            value === null || value === undefined
              ? ''
              : typeof value === 'string'
                ? value
                : JSON.stringify(value, null, 2)
        } else {
          flat[key] = value ?? undefined
        }
      }
    }
    form.setFieldsValue(flat)
  }, [config, form])

  function optionsFor(field: ConfigField) {
    if (field.name === 'email_template') {
      return (emailTplQuery.data ?? []).map((t) => ({ value: t, label: t }))
    }
    if (field.name === 'frontend_theme') {
      return (themeTplQuery.data ?? []).map((t) => ({ value: t, label: t }))
    }
    return field.options
  }

  function renderField(field: ConfigField) {
    let control: React.ReactNode
    switch (field.type) {
      case 'switch':
        control = <Switch disabled={field.readonly} />
        break
      case 'number':
        control = (
          <InputNumber style={{ width: '100%' }} disabled={field.readonly} />
        )
        break
      case 'select':
        control = (
          <Select
            allowClear
            disabled={field.readonly}
            options={optionsFor(field)}
            placeholder="未设置"
          />
        )
        break
      case 'password':
        control = <Input.Password disabled={field.readonly} autoComplete="off" />
        break
      case 'tags':
        control = (
          <Select
            mode="tags"
            disabled={field.readonly}
            tokenSeparators={[',', ' ']}
            placeholder="回车添加"
          />
        )
        break
      case 'json':
        control = (
          <Input.TextArea
            rows={4}
            disabled={field.readonly}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        )
        break
      case 'textarea':
        control = <Input.TextArea rows={3} disabled={field.readonly} />
        break
      default:
        control = <Input disabled={field.readonly} />
    }

    return (
      <Col span={field.span ?? 24} key={field.name}>
        <Form.Item
          name={field.name}
          label={
            <Space size={4}>
              {field.label}
              {field.dangerous && <Tag color="red">影响面大</Tag>}
              {field.readonly && <Tag>只读</Tag>}
            </Space>
          }
          valuePropName={field.type === 'switch' ? 'checked' : undefined}
          extra={field.help}
        >
          {control}
        </Form.Item>
      </Col>
    )
  }

  function buildPayload(values: Values): Values {
    const payload: Values = {}
    for (const group of CONFIG_GROUPS) {
      for (const field of group.fields) {
        if (field.readonly) continue
        const raw = values[field.name]
        if (SWITCH_FIELDS.has(field.name)) {
          // 后端是 in:0,1，传 true/false 会 422
          payload[field.name] = raw ? 1 : 0
        } else if (JSON_FIELDS.has(field.name)) {
          if (typeof raw === 'string' && raw.trim() !== '') {
            payload[field.name] = JSON.parse(raw)
          } else {
            payload[field.name] = []
          }
        } else if (raw !== undefined) {
          payload[field.name] = raw
        }
      }
    }
    return payload
  }

  async function doSave() {
    const values = form.getFieldsValue()
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
      // 三种可能：成功 / 后端自杀导致连接中断 / Workerman 下的 config:cache 异常
      let saveFailed = false
      await saveConfig(payload).catch(() => {
        saveFailed = true
      })

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

  function confirmSave() {
    Modal.confirm({
      title: '保存配置需要在服务器上补一步',
      icon: <ExclamationCircleFilled />,
      width: 620,
      content: (
        <Space direction="vertical" size={8}>
          <span>
            后端会先把配置写进 <Typography.Text code>config/v2board.php</Typography.Text>，
            然后调 <Typography.Text code>config:cache</Typography.Text> 重建缓存并重启进程。
          </span>
          <Typography.Text strong type="danger">
            但在 Workerman 常驻模式下第二步会抛异常（AdapterMan 不提供
            $_SERVER['PHP_SELF']，Symfony Console 构造时就崩了）——
            结果是文件写进去了、新配置却不生效。
          </Typography.Text>
          <span>
            所以保存后大概率会提示「已写入未生效」，届时按提示在服务器上执行两条命令即可。
            本页会自动探活并给出后续步骤。
          </span>
        </Space>
      ),
      okText: '我了解，继续保存',
      onOk: doSave,
    })
  }

  if (outcome === 'down') {
    return (
      <Result
        status="warning"
        title="后端在 60 秒内没有恢复"
        subTitle="配置很可能已经写入成功，但 Workerman 没有被重新拉起。请登录服务器执行 php -c cli-php.ini webman.php start -d 后刷新本页。"
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        }
      />
    )
  }

  if (outcome === 'written') {
    return (
      <Result
        status="info"
        title="配置已写入文件，但尚未生效"
        subTitle="这是后端在 Workerman 模式下的已知问题：写文件成功，但重建配置缓存那一步抛异常，所以进程仍在用旧配置。"
        extra={
          <Space direction="vertical" align="start" size={12}>
            <Typography.Text>在服务器上执行这两条命令即可让配置生效：</Typography.Text>
            <Typography.Paragraph
              copyable={{
                text:
                  'cd /path/to/v2board && php artisan config:cache && ' +
                  'php -c cli-php.ini webman.php stop && ' +
                  'php -c cli-php.ini webman.php start -d',
              }}
              style={{
                background: '#fafafa',
                padding: '8px 12px',
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 12,
                marginBottom: 0,
              }}
            >
              php artisan config:cache
              <br />
              php -c cli-php.ini webman.php stop && php -c cli-php.ini webman.php start -d
            </Typography.Paragraph>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              注意第二条会让面板短暂中断。执行完刷新本页确认新值已生效。
            </Typography.Text>
            <Button type="primary" onClick={() => window.location.reload()}>
              我已执行，重新加载
            </Button>
          </Space>
        }
      />
    )
  }

  return (
    <Spin
      spinning={configQuery.isFetching || saving}
      tip={outcome === 'waiting' ? '正在确认后端状态…' : undefined}
    >
      <Card
        title={
          <Space>
            <span>系统配置</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              保存后需在服务器上补执行 config:cache 才生效
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => qc.invalidateQueries({ queryKey: ['config'] })}
            >
              重新读取
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={confirmSave}
            >
              保存
            </Button>
          </Space>
        }
      >
        {undeclared.length > 0 && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={`后端还返回了 ${undeclared.length} 个本页未收录的字段`}
            description={
              <>
                <div style={{ marginBottom: 6 }}>
                  这些字段在 config/fetch 里出现，但本页 schema 未声明 ——
                  它们要么是只读派生值，要么是新增字段。保存时不会被改动。
                </div>
                <Space size={4} wrap>
                  {undeclared.map((k) => (
                    <Tag key={k}>{k}</Tag>
                  ))}
                </Space>
              </>
            }
          />
        )}

        <Form<Values> form={form} layout="vertical">
          <Tabs
            tabPosition="left"
            items={CONFIG_GROUPS.map((group) => ({
              key: group.key,
              label: group.title,
              children: (
                <div style={{ paddingRight: 8 }}>
                  {group.description && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message={group.description}
                    />
                  )}
                  <Row gutter={16}>{group.fields.map(renderField)}</Row>

                  {group.key === 'email' && (
                    <Button
                      icon={<SendOutlined />}
                      onClick={async () => {
                        await testSendMail()
                        message.success(
                          '测试邮件已发送到当前管理员邮箱，请查收（失败原因会在响应的 log 字段里）',
                        )
                      }}
                    >
                      发送测试邮件
                    </Button>
                  )}

                  {group.key === 'telegram' && (
                    <Button
                      icon={<SendOutlined />}
                      onClick={async () => {
                        const token = form.getFieldValue('telegram_bot_token')
                        if (!token) {
                          message.warning('请先填写 Bot Token')
                          return
                        }
                        await setTelegramWebhook(token)
                        message.success('Webhook 已设置')
                      }}
                    >
                      设置 Webhook
                    </Button>
                  )}
                </div>
              ),
            }))}
          />
        </Form>
      </Card>
    </Spin>
  )
}
