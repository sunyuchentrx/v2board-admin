import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  Result,
  Row,
  Select,
  Skeleton,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  CheckCircleFilled,
  LinkOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  SkinOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchThemeConfig,
  fetchThemes,
  saveThemeConfig,
  type ThemeConfigItem,
  type ThemeDefinition,
} from '@/api/ops'
import FormSection from '@/components/FormSection'
import SettingSwitch from '@/components/SettingSwitch'
import './ThemePage.css'

type Values = Record<string, any>

/** config.json 里常带 placeholder，接口类型没声明 —— 只用于展示 */
type ConfigItem = ThemeConfigItem & { placeholder?: string }

function fieldType(item: ThemeConfigItem) {
  return (item.field_type ?? 'input').toLowerCase()
}

function isSwitchField(item: ThemeConfigItem) {
  const type = fieldType(item)
  return type === 'switch' || type === 'boolean'
}

/**
 * 字段标题。label 来自第三方 config.json，长度不可控：
 * 两列布局下超长 label 单行省略（悬停看全文），否则折行会把同一行两个控件的上沿错开。
 * 没写 label 时退回 field_name，按代码样式显示 —— 这种长串没有空格，要允许任意处断行。
 */
function FieldTitle({ item, ellipsis }: { item: ThemeConfigItem; ellipsis?: boolean }) {
  const cls = ellipsis ? 'theme-page-field-label' : undefined
  if (item.label) {
    return (
      <span className={cls} title={item.label}>
        {item.label}
      </span>
    )
  }
  return (
    <span className={`${cls ? `${cls} ` : ''}theme-page-field-key mono`} title={item.field_name}>
      {item.field_name}
    </span>
  )
}

/** 主题 config.json 里的字段类型，映射到控件（开关单独用 SettingSwitch 渲染） */
function renderControl(item: ConfigItem) {
  const type = fieldType(item)
  if (type === 'select') {
    const opts = item.select_options
    const options = Array.isArray(opts)
      ? opts.map((o) => ({ value: o, label: o }))
      : Object.entries(opts ?? {}).map(([v, l]) => ({ value: v, label: String(l) }))
    return (
      <Select
        allowClear
        options={options}
        placeholder={item.placeholder || '未设置'}
        style={{ width: '100%' }}
      />
    )
  }
  if (type === 'textarea') {
    // 页脚 HTML / 客服脚本这类代码用等宽字体
    const code = /html|css|js|script|code/i.test(item.field_name)
    return (
      <Input.TextArea
        autoSize={{ minRows: 3, maxRows: 10 }}
        className={code ? 'mono' : undefined}
        placeholder={item.placeholder}
      />
    )
  }
  const isUrl = /url/i.test(item.field_name)
  return (
    <Input
      placeholder={item.placeholder || (isUrl ? 'https://' : undefined)}
      prefix={isUrl ? <LinkOutlined className="muted" /> : undefined}
    />
  )
}

/** 预览图只接受 http(s) / 站内路径；加载失败时退回占位 */
function ThemeCover({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false)
  const usable = !!src && /^(https?:\/\/|\/)/i.test(src) && !failed
  return (
    <div className="theme-page-cover">
      {usable ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          // 后台地址（secure_path）不能通过 Referer 泄露给图床
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="theme-page-cover-fallback">
          <SkinOutlined />
        </div>
      )}
    </div>
  )
}

function ThemeCard({
  name,
  definition,
  active,
  dirty,
  onConfigure,
}: {
  name: string
  definition: ThemeDefinition
  active: boolean
  /** 抽屉关了但表单里还有没保存的修改（表单一直挂着，重新打开能接着改） */
  dirty: boolean
  onConfigure: () => void
}) {
  const version = definition.version?.replace(/^v/i, '')
  const empty = definition.configs.length === 0
  return (
    <Card
      className={`theme-page-card${active ? ' is-active' : ''}`}
      cover={<ThemeCover src={definition.images} />}
    >
      <div className="theme-page-card-title">
        <span className="theme-page-card-name" title={name}>
          {name}
        </span>
        {version && (
          <Tag bordered={false} className="theme-page-card-version" title={`v${version}`}>
            v{version}
          </Tag>
        )}
        {active && (
          <Tag bordered={false} color="success" icon={<CheckCircleFilled />} className="theme-page-card-badge">
            启用中
          </Tag>
        )}
      </div>
      {/* 描述是区分各主题的主要信息，用 text-secondary（颜色在 CSS 里），不用更淡的 type="secondary" */}
      <Typography.Paragraph
        className="theme-page-card-desc"
        ellipsis={{ rows: 2, tooltip: definition.description }}
      >
        {definition.description || '—'}
      </Typography.Paragraph>
      <div className="theme-page-card-foot">
        <span className="theme-page-card-foot-info">
          <span className="theme-page-card-meta tabular-nums">{definition.configs.length} 个配置项</span>
          {dirty && (
            <Tooltip title="修改还没保存，重新打开配置可以接着改">
              <Tag bordered={false} color="warning" className="theme-page-card-dirty">
                未保存
              </Tag>
            </Tooltip>
          )}
        </span>
        <Tooltip title={empty ? '该主题没有可配置项' : undefined}>
          <Button
            type={active && !empty ? 'primary' : 'default'}
            icon={<SettingOutlined />}
            disabled={empty}
            onClick={onConfigure}
          >
            配置
          </Button>
        </Tooltip>
      </div>
    </Card>
  )
}

/** 加载占位：结构和 ThemeCard 一致（封面 + 标题 + 两行描述 + 底栏），数据回来时不跳 */
function ThemeCardSkeleton() {
  return (
    <Card className="theme-page-card is-skeleton" cover={<div className="theme-page-cover" />}>
      <div className="theme-page-card-title">
        <Skeleton.Input active size="small" className="theme-page-skeleton-name" />
      </div>
      <Skeleton
        active
        title={false}
        paragraph={{ rows: 2, width: ['92%', '60%'] }}
        className="theme-page-card-desc theme-page-skeleton-desc"
      />
      <div className="theme-page-card-foot">
        <Skeleton.Input active size="small" className="theme-page-skeleton-meta" />
        <Skeleton.Button active className="theme-page-skeleton-btn" />
      </div>
    </Card>
  )
}

function ThemeConfigDrawer({
  name,
  definition,
  active,
  open,
  onClose,
  onDirtyChange,
}: {
  name: string
  /** 重新拉取主题列表后这个主题可能不见了（config.json 被删 / 改坏） */
  definition: ThemeDefinition | undefined
  active: boolean
  open: boolean
  onClose: () => void
  onDirtyChange: (name: string, dirty: boolean) => void
}) {
  const qc = useQueryClient()
  const screens = Grid.useBreakpoint()
  const [form] = Form.useForm<Values>()
  const [saving, setSaving] = useState(false)
  const [notApplied, setNotApplied] = useState(false)
  // 只用来提示「有未保存的修改」。不用 form.isFieldsTouched()：保存成功后它仍然是 true
  const [dirty, setDirty] = useState(false)
  const alertRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onDirtyChange(name, dirty)
  }, [name, dirty, onDirtyChange])
  // 主题从列表里消失、抽屉被卸掉时，别在父组件里留下一个「未保存」
  useEffect(() => () => onDirtyChange(name, false), [name, onDirtyChange])

  const { data: current, isFetching } = useQuery({
    queryKey: ['theme-config', name],
    queryFn: () => fetchThemeConfig(name),
  })

  useEffect(() => {
    if (!definition) return
    const values: Values = {}
    for (const item of definition.configs) {
      const saved = current?.[item.field_name]
      const type = fieldType(item)
      const raw = saved !== undefined && saved !== null ? saved : item.default_value
      values[item.field_name] =
        type === 'switch' || type === 'boolean'
          ? raw === true || raw === 1 || raw === '1'
          : (raw ?? undefined)
    }
    form.setFieldsValue(values)
    // 表单刚按服务器上的值回填过，此刻没有未保存的修改
    setDirty(false)
  }, [definition, current, form])

  // 保存按钮在抽屉底部，失败提示在顶部 —— 滚过去，别让人以为保存成功了
  useEffect(() => {
    if (notApplied) alertRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [notApplied])

  async function handleSave() {
    if (!definition) return
    const values = form.getFieldsValue()
    // 后端只会保留 config.json 里声明过的字段，缺的补空串
    const payload: Record<string, unknown> = {}
    for (const item of definition.configs) {
      const v = values[item.field_name]
      const type = fieldType(item)
      payload[item.field_name] =
        type === 'switch' || type === 'boolean' ? (v ? 1 : 0) : (v ?? '')
    }

    setSaving(true)
    setNotApplied(false)
    try {
      await saveThemeConfig(name, payload)
      setDirty(false)
      // 提示默认贴在视口顶部 8px，正好压在抽屉 header 的关闭按钮和标题上；往下挪到 header 之下
      message.success({ content: '主题配置已保存', style: { marginTop: 56 } })
      // 和原来的 Tab 表单一样，保存后留在表单里（重新拉取后回填），由用户自己关
      qc.invalidateQueries({ queryKey: ['theme-config', name] })
    } catch {
      // 和系统配置同一个坑：后端也调 Artisan::call('config:cache')，
      // Workerman 下会抛 PHP_SELF 异常 → 文件写了但没生效，返回 abort(500,'保存失败')
      setNotApplied(true)
    } finally {
      setSaving(false)
    }
  }

  // 按控件类型分组：同一行只放等高的输入框/下拉，开关和长文本各自成组，避免错位
  const configs = (definition?.configs ?? []) as ConfigItem[]
  const sections = [
    {
      key: 'basic',
      title: '常规设置',
      items: configs.filter((i) => !isSwitchField(i) && fieldType(i) !== 'textarea'),
    },
    { key: 'switch', title: '功能开关', items: configs.filter(isSwitchField) },
    {
      key: 'long',
      title: '自定义内容',
      items: configs.filter((i) => fieldType(i) === 'textarea'),
    },
  ].filter((s) => s.items.length > 0)

  const version = definition?.version?.replace(/^v/i, '')

  // 保存中不许关：抽屉一关，保存失败后的「已写入但未生效」提示就没人看得到了
  function requestClose() {
    if (!saving) onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      // 关掉抽屉不卸载表单（父组件也一直挂着它）：和原来的 Tabs 一样，没保存的修改重新打开还在
      forceRender
      maskClosable={false}
      keyboard={!saving}
      rootClassName={`theme-page-drawer${saving ? ' is-saving' : ''}`}
      width={screens.md ? 720 : '100%'}
      title={
        <div className="theme-page-drawer-title">
          <span className="theme-page-drawer-name">
            <span className="theme-page-drawer-name-prefix">配置主题「</span>
            <span className="theme-page-drawer-name-text" title={name}>
              {name}
            </span>
            <span className="theme-page-drawer-name-suffix">」</span>
          </span>
          {version && (
            <Tag bordered={false} className="theme-page-card-version" title={`v${version}`}>
              v{version}
            </Tag>
          )}
          {active && (
            <Tag bordered={false} color="success" icon={<CheckCircleFilled />}>
              启用中
            </Tag>
          )}
        </div>
      }
      footer={
        <Flex justify="space-between" align="center" gap={12}>
          <span className="theme-page-drawer-dirty">{dirty && '有未保存的修改'}</span>
          <Flex gap={8}>
            {/* 不自动插空格：旁边的「保存」带图标不插，两个按钮字距要一致 */}
            <Button disabled={saving} autoInsertSpace={false} onClick={requestClose}>
              关闭
            </Button>
            {/* 回填完成前不能保存：否则发出去的是 default_value / 空串，会把已存的配置整份覆盖
                （原来按钮在 Spin 里，加载遮罩挡住了点击；挪到 footer 后要显式禁用） */}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={isFetching || !definition}
              onClick={handleSave}
            >
              保存
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Spin spinning={isFetching || saving}>
        <Flex vertical gap={16}>
          {!definition && <Result status="warning" title={`主题 ${name} 没有可用的 config.json`} />}

          {/* 和卡片上是同一段描述，同样用 text-secondary（颜色在 CSS 里），不用更淡的 type="secondary" */}
          {definition?.description && (
            <Typography.Paragraph className="theme-page-drawer-desc">
              {definition.description}
            </Typography.Paragraph>
          )}

          {notApplied && (
            <div ref={alertRef} className="theme-page-save-alert">
              <Alert
                type="warning"
                showIcon
                // 请求层同时会弹全局「保存失败」，这里要和它说法一致：接口报错，但文件多半已经写进去了
                message="保存接口报错，但配置文件可能已写入、尚未生效"
                description={
                  <>
                    后端保存主题配置时也会调 config:cache，在 Workerman 常驻模式下这一步会抛异常。若前台没变化，在服务器上执行：
                    <Typography.Paragraph
                      copyable={{
                        text:
                          'cd /path/to/v2board && php artisan config:cache && ' +
                          'php -c cli-php.ini webman.php stop && ' +
                          'php -c cli-php.ini webman.php start -d',
                      }}
                      className="code-block"
                      style={{ marginTop: 8, marginBottom: 0 }}
                    >
                      php artisan config:cache && webman 重启
                    </Typography.Paragraph>
                  </>
                }
              />
            </div>
          )}

          <Form<Values> form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
            {sections.map((section, idx) => (
              <FormSection key={section.key} title={section.title} first={idx === 0}>
                <Row gutter={16}>
                  {section.items.map((item) => {
                    if (section.key === 'switch') {
                      return (
                        <Col xs={24} md={12} key={item.field_name}>
                          <SettingSwitch name={item.field_name} title={<FieldTitle item={item} />} />
                        </Col>
                      )
                    }
                    return (
                      <Col xs={24} md={section.key === 'long' ? 24 : 12} key={item.field_name}>
                        <Form.Item name={item.field_name} label={<FieldTitle item={item} ellipsis />}>
                          {renderControl(item)}
                        </Form.Item>
                      </Col>
                    )
                  })}
                </Row>
              </FormSection>
            ))}
          </Form>
        </Flex>
      </Spin>
    </Drawer>
  )
}

export default function ThemePage() {
  const { data: themes, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['themes'],
    queryFn: fetchThemes,
  })

  // 打开过的主题各挂一个抽屉，关掉也不卸载 —— 原来 Tabs 让各主题的表单一直挂着，切换主题不丢修改
  const [mounted, setMounted] = useState<string[]>([])
  const [openName, setOpenName] = useState<string | null>(null)
  const [dirtyNames, setDirtyNames] = useState<ReadonlySet<string>>(() => new Set())

  const active = themes?.active
  // 原来的 Tabs 默认选中启用中的主题；卡片网格里把它排第一，其余保持 config 里的顺序
  const names = Object.keys(themes?.themes ?? {}).sort(
    (a, b) => Number(b === active) - Number(a === active),
  )

  function openConfig(name: string) {
    setMounted((m) => (m.includes(name) ? m : [...m, name]))
    setOpenName(name)
  }

  const handleDirtyChange = useCallback((name: string, dirty: boolean) => {
    setDirtyNames((prev) => {
      if (prev.has(name) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(name)
      else next.delete(name)
      return next
    })
  }, [])

  return (
    <Flex vertical gap={16}>
      <Alert
        type="info"
        showIcon
        className="theme-page-alert"
        message="这里改的是前台主题的外观配置，不是本后台的主题"
        description={
          <>
            当前启用的前台主题是{' '}
            {isLoading ? (
              // 加载中先占位，别闪一下「未知」
              <Skeleton.Input active size="small" className="theme-page-inline-skeleton" />
            ) : (
              <Typography.Text code>{active ?? '未知'}</Typography.Text>
            )}
            。要切换启用哪个主题，去<Link to="/config">系统配置</Link>的「前台主题」标签页。
          </>
        }
      />

      <div className="theme-page-head">
        <div className="theme-page-head-text">
          <div className="theme-page-head-title">
            可配置的主题
            {!isLoading && <span className="theme-page-head-count tabular-nums">{names.length}</span>}
          </div>
          <div className="theme-page-head-desc">配置项由各主题的 config.json 定义</div>
        </div>
        <Button icon={<ReloadOutlined />} loading={isFetching && !isLoading} onClick={() => refetch()}>
          刷新
        </Button>
      </div>

      {isLoading ? (
        <Row gutter={[16, 16]}>
          {[0, 1].map((i) => (
            <Col xs={24} sm={12} xl={8} key={i}>
              <ThemeCardSkeleton />
            </Col>
          ))}
        </Row>
      ) : names.length === 0 ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Flex vertical gap={4}>
                <span>没有检测到可配置的主题</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  主题需要在 public/theme/{'{名称}'}/config.json 里声明 configs 数组才会出现在这里。
                </Typography.Text>
              </Flex>
            }
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {names.map((name) => (
            <Col xs={24} sm={12} xl={8} key={name}>
              <ThemeCard
                name={name}
                definition={themes!.themes[name]!}
                active={name === active}
                dirty={dirtyNames.has(name)}
                onConfigure={() => openConfig(name)}
              />
            </Col>
          ))}
        </Row>
      )}

      {mounted.map((name) => {
        const definition = themes?.themes?.[name]
        // 主题从列表里消失了：关着的抽屉直接卸掉；开着的留下来，显示「没有可用的 config.json」
        if (!definition && name !== openName) return null
        return (
          <ThemeConfigDrawer
            key={name}
            name={name}
            definition={definition}
            active={name === active}
            open={name === openName}
            onClose={() => setOpenName(null)}
            onDirtyChange={handleDirtyChange}
          />
        )
      })}
    </Flex>
  )
}
