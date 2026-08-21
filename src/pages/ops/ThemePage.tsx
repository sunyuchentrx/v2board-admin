import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Typography,
  message,
} from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchThemeConfig,
  fetchThemes,
  saveThemeConfig,
  type ThemeConfigItem,
} from '@/api/ops'

type Values = Record<string, any>

/** 主题 config.json 里的字段类型，映射到控件 */
function renderControl(item: ThemeConfigItem) {
  const type = (item.field_type ?? 'input').toLowerCase()
  if (type === 'switch' || type === 'boolean') return <Switch />
  if (type === 'select') {
    const opts = item.select_options
    const options = Array.isArray(opts)
      ? opts.map((o) => ({ value: o, label: o }))
      : Object.entries(opts ?? {}).map(([v, l]) => ({ value: v, label: String(l) }))
    return <Select allowClear options={options} placeholder="未设置" />
  }
  if (type === 'textarea') return <Input.TextArea rows={3} />
  return <Input />
}

function ThemeConfigForm({ name }: { name: string }) {
  const qc = useQueryClient()
  const [form] = Form.useForm<Values>()
  const [saving, setSaving] = useState(false)
  const [notApplied, setNotApplied] = useState(false)

  const { data: themes } = useQuery({ queryKey: ['themes'], queryFn: fetchThemes })
  const { data: current, isFetching } = useQuery({
    queryKey: ['theme-config', name],
    queryFn: () => fetchThemeConfig(name),
  })

  const definition = themes?.themes?.[name]

  useEffect(() => {
    if (!definition) return
    const values: Values = {}
    for (const item of definition.configs) {
      const saved = current?.[item.field_name]
      const type = (item.field_type ?? 'input').toLowerCase()
      const raw = saved !== undefined && saved !== null ? saved : item.default_value
      values[item.field_name] =
        type === 'switch' || type === 'boolean'
          ? raw === true || raw === 1 || raw === '1'
          : (raw ?? undefined)
    }
    form.setFieldsValue(values)
  }, [definition, current, form])

  async function handleSave() {
    const values = form.getFieldsValue()
    // 后端只会保留 config.json 里声明过的字段，缺的补空串
    const payload: Record<string, unknown> = {}
    for (const item of definition?.configs ?? []) {
      const v = values[item.field_name]
      const type = (item.field_type ?? 'input').toLowerCase()
      payload[item.field_name] =
        type === 'switch' || type === 'boolean' ? (v ? 1 : 0) : (v ?? '')
    }

    setSaving(true)
    setNotApplied(false)
    try {
      await saveThemeConfig(name, payload)
      message.success('主题配置已保存')
      qc.invalidateQueries({ queryKey: ['theme-config', name] })
    } catch {
      // 和系统配置同一个坑：后端也调 Artisan::call('config:cache')，
      // Workerman 下会抛 PHP_SELF 异常 → 文件写了但没生效，返回 abort(500,'保存失败')
      setNotApplied(true)
    } finally {
      setSaving(false)
    }
  }

  if (!definition) {
    return <Result status="warning" title={`主题 ${name} 没有可用的 config.json`} />
  }

  return (
    <Spin spinning={isFetching || saving}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {definition.description && (
          <Typography.Text type="secondary">{definition.description}</Typography.Text>
        )}

        {notApplied && (
          <Alert
            type="warning"
            showIcon
            message="配置文件已写入，但可能尚未生效"
            description={
              <>
                后端保存主题配置时也会调 config:cache，在 Workerman 常驻模式下
                这一步会抛异常。若前台没变化，在服务器上执行：
                <Typography.Paragraph
                  copyable={{
                    text:
                      'cd /path/to/v2board && php artisan config:cache && ' +
                      'php -c cli-php.ini webman.php stop && ' +
                      'php -c cli-php.ini webman.php start -d',
                  }}
                  style={{
                    background: '#fff',
                    padding: '6px 10px',
                    borderRadius: 4,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    marginTop: 6,
                    marginBottom: 0,
                  }}
                >
                  php artisan config:cache && webman 重启
                </Typography.Paragraph>
              </>
            }
          />
        )}

        <Form<Values> form={form} layout="vertical">
          <Row gutter={16}>
            {definition.configs.map((item) => (
              <Col span={12} key={item.field_name}>
                <Form.Item
                  name={item.field_name}
                  label={item.label || item.field_name}
                  valuePropName={
                    ['switch', 'boolean'].includes(
                      (item.field_type ?? '').toLowerCase(),
                    )
                      ? 'checked'
                      : undefined
                  }
                >
                  {renderControl(item)}
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
        >
          保存「{name}」的配置
        </Button>
      </Space>
    </Spin>
  )
}

export default function ThemePage() {
  const { data: themes, isFetching } = useQuery({
    queryKey: ['themes'],
    queryFn: fetchThemes,
  })

  const names = Object.keys(themes?.themes ?? {})
  const active = themes?.active

  return (
    <Card
      title={
        <Space>
          <span>主题配置</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            配置项由各主题的 config.json 定义
          </Typography.Text>
        </Space>
      }
    >
      <Spin spinning={isFetching}>
        {names.length === 0 ? (
          <Result
            status="info"
            title="没有检测到可配置的主题"
            subTitle="主题需要在 public/theme/{名称}/config.json 里声明 configs 数组才会出现在这里。"
          />
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="这里改的是前台主题的外观配置，不是本后台的主题"
              description={
                <>
                  当前启用的前台主题是 <Typography.Text code>{active ?? '未知'}</Typography.Text>
                  。要切换启用哪个主题，去「系统配置 → 前台主题」。
                </>
              }
            />
            <Tabs
              defaultActiveKey={active && names.includes(active) ? active : names[0]}
              items={names.map((name) => ({
                key: name,
                label: name === active ? `${name}（启用中）` : name,
                children: <ThemeConfigForm name={name} />,
              }))}
            />
          </>
        )}
      </Spin>
    </Card>
  )
}
