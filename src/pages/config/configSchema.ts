/**
 * 系统配置的字段元数据。
 *
 * 两个关键事实：
 *  1. 实测口径：config/fetch 返回 **81 个字段**，ConfigSave::RULES 白名单 **84 个**，
 *     交集 81 —— **没有只读字段**。差集是 3 个「可写但 fetch 不回显」的：
 *     try_out_enable / telegram_discuss_id / telegram_channel_id。
 *     这三个界面上能填能提交，但打开页面时无法显示当前值（已在各自 help 里写明）。
 *     `readonly` 标记因此当前无人使用，保留是为了以后后端真出现只读字段时能用。
 *  2. 校验规则里的 `in:0,1` 等枚举必须精确对上，否则 422。
 *     每个字段的 type/options 都是照 ConfigSave.php 抄的。
 */

export type ConfigFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'switch'
  | 'select'
  | 'password'
  /** 字符串数组，用 tags 输入 */
  | 'tags'
  /** 任意 JSON，用文本域 */
  | 'json'

export interface ConfigField {
  name: string
  label: string
  type: ConfigFieldType
  options?: { value: string | number; label: string }[]
  help?: string
  /** 只在 fetch 里出现、不在 save 白名单里 —— 展示但不可编辑 */
  readonly?: boolean
  /** 改动后影响面很大，需要额外确认 */
  dangerous?: boolean
  span?: number
}

export interface ConfigGroup {
  /** 与 fetch 返回的分组键一致 */
  key: string
  title: string
  description?: string
  fields: ConfigField[]
}

const BOOL: Pick<ConfigField, 'type'> = { type: 'switch' }

export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    key: 'site',
    title: '站点',
    fields: [
      { name: 'app_name', label: '站点名称', type: 'text' },
      { name: 'app_description', label: '站点描述', type: 'text' },
      {
        name: 'app_url',
        label: '站点地址',
        type: 'text',
        help: '必须是合法 URL（nullable|url），影响邮件里的链接与安全模式判定',
      },
      { name: 'logo', label: 'Logo 地址', type: 'text', help: '必须是合法 URL' },
      {
        name: 'subscribe_url',
        label: '订阅地址',
        type: 'text',
        help: '多个用英文逗号分隔，后端会随机取一个下发',
      },
      {
        name: 'subscribe_path',
        label: '订阅路径',
        type: 'text',
        help: '必须以 / 开头（regex:/^\\//）',
      },
      { name: 'tos_url', label: '服务条款地址', type: 'text', help: '必须是合法 URL' },
      { name: 'currency', label: '货币代码', type: 'text', span: 6 },
      { name: 'currency_symbol', label: '货币符号', type: 'text', span: 6 },
      { name: 'force_https', label: '强制 HTTPS', ...BOOL, span: 6 },
      { name: 'stop_register', label: '停止注册', ...BOOL, span: 6 },
      {
        name: 'try_out_enable',
        label: '开启试用',
        ...BOOL,
        span: 6,
        help: '注意：这个字段可写但 fetch 不返回，界面上无法回显当前值',
      },
      { name: 'try_out_plan_id', label: '试用套餐 ID', type: 'number', span: 6 },
      { name: 'try_out_hour', label: '试用时长(小时)', type: 'number', span: 6 },
    ],
  },
  {
    key: 'safe',
    title: '安全',
    description: '涉及登录、注册与后台入口，改动前请确认影响面',
    fields: [
      {
        name: 'secure_path',
        label: '后台路径',
        type: 'text',
        dangerous: true,
        help: '至少 8 位，只能是字母数字下划线和连字符。改了之后旧地址立即失效，新后台入口变成 /{新路径}/v2，管理接口前缀也一起变',
      },
      { name: 'safe_mode_enable', label: '安全模式', ...BOOL, span: 8, help: '开启后只允许通过站点地址的域名访问' },
      { name: 'email_verify', label: '邮箱验证', ...BOOL, span: 8 },
      { name: 'email_whitelist_enable', label: '邮箱后缀白名单', ...BOOL, span: 8 },
      {
        name: 'email_whitelist_suffix',
        label: '允许的邮箱后缀',
        type: 'tags',
        help: '不含 @，例如 gmail.com',
      },
      { name: 'email_gmail_limit_enable', label: '限制 Gmail 别名', ...BOOL, span: 8 },
      { name: 'recaptcha_enable', label: '开启人机验证', ...BOOL, span: 8, help: '本 fork 用的是 Cloudflare Turnstile' },
      { name: 'recaptcha_key', label: '验证密钥 (Secret)', type: 'password', span: 12 },
      { name: 'recaptcha_site_key', label: '验证站点密钥 (Site Key)', type: 'text', span: 12 },
      { name: 'register_limit_by_ip_enable', label: '按 IP 限制注册', ...BOOL, span: 8 },
      { name: 'register_limit_count', label: '同 IP 注册上限', type: 'number', span: 8 },
      { name: 'register_limit_expire', label: '注册限制时长(分钟)', type: 'number', span: 8 },
      { name: 'password_limit_enable', label: '限制密码错误次数', ...BOOL, span: 8 },
      { name: 'password_limit_count', label: '允许错误次数', type: 'number', span: 8 },
      { name: 'password_limit_expire', label: '锁定时长(分钟)', type: 'number', span: 8 },
    ],
  },
  {
    key: 'subscribe',
    title: '订阅',
    fields: [
      { name: 'plan_change_enable', label: '允许更改订阅', ...BOOL, span: 8 },
      {
        name: 'reset_traffic_method',
        label: '流量重置方式',
        type: 'select',
        span: 8,
        options: [
          { value: 0, label: '每月 1 号' },
          { value: 1, label: '按购买日期' },
          { value: 2, label: '不重置' },
          { value: 3, label: '每年 1 月 1 号' },
          { value: 4, label: '按年重置' },
        ],
      },
      { name: 'surplus_enable', label: '启用旧订单折抵', ...BOOL, span: 8 },
      { name: 'allow_new_period', label: '允许新周期', ...BOOL, span: 8 },
      {
        name: 'show_subscribe_method',
        label: '订阅地址形式',
        type: 'select',
        span: 8,
        options: [
          { value: 0, label: '带 token 查询参数' },
          { value: 1, label: '形式 1' },
          { value: 2, label: '形式 2' },
        ],
      },
      { name: 'show_subscribe_expire', label: '订阅到期提前天数', type: 'number', span: 8 },
      { name: 'show_info_to_server_enable', label: '向节点下发用户信息', ...BOOL, span: 8 },
      { name: 'new_order_event_id', label: '新购事件', ...BOOL, span: 8 },
      { name: 'renew_order_event_id', label: '续费事件', ...BOOL, span: 8 },
      { name: 'change_order_event_id', label: '变更事件', ...BOOL, span: 8 },
    ],
  },
  {
    key: 'invite',
    title: '邀请与佣金',
    fields: [
      { name: 'invite_force', label: '强制邀请注册', ...BOOL, span: 8 },
      { name: 'invite_commission', label: '默认佣金比例(%)', type: 'number', span: 8 },
      { name: 'invite_gen_limit', label: '每人邀请码上限', type: 'number', span: 8 },
      { name: 'invite_never_expire', label: '邀请码永不过期', ...BOOL, span: 8 },
      { name: 'commission_first_time_enable', label: '仅首单返佣', ...BOOL, span: 8 },
      { name: 'commission_auto_check_enable', label: '自动确认佣金', ...BOOL, span: 8 },
      { name: 'commission_withdraw_limit', label: '提现门槛(元)', type: 'number', span: 8 },
      { name: 'withdraw_close_enable', label: '关闭提现', ...BOOL, span: 8 },
      {
        name: 'commission_withdraw_method',
        label: '提现方式',
        type: 'tags',
        help: '例如 支付宝、USDT',
      },
      { name: 'commission_distribution_enable', label: '启用三级分销', ...BOOL, span: 6 },
      { name: 'commission_distribution_l1', label: '一级比例(%)', type: 'number', span: 6 },
      { name: 'commission_distribution_l2', label: '二级比例(%)', type: 'number', span: 6 },
      { name: 'commission_distribution_l3', label: '三级比例(%)', type: 'number', span: 6 },
    ],
  },
  {
    key: 'server',
    title: '节点通信',
    description: '节点端（V2bX / v2node）与面板对接的参数',
    fields: [
      { name: 'server_token', label: '通信密钥', type: 'password', dangerous: true, help: '至少 16 位。改了之后所有节点都要同步更新配置，否则会全部掉线' },
      { name: 'server_api_url', label: '节点 API 地址', type: 'text' },
      { name: 'server_pull_interval', label: '拉取间隔(秒)', type: 'number', span: 8 },
      { name: 'server_push_interval', label: '上报间隔(秒)', type: 'number', span: 8 },
      {
        name: 'device_limit_mode',
        label: '设备限制模式',
        type: 'select',
        span: 8,
        options: [
          { value: 0, label: '宽松' },
          { value: 1, label: '严格' },
        ],
      },
      { name: 'server_node_report_min_traffic', label: '节点上报最小流量', type: 'number', span: 12 },
      { name: 'server_device_online_min_traffic', label: '设备在线最小流量', type: 'number', span: 12 },
    ],
  },
  {
    key: 'email',
    title: '邮件',
    fields: [
      { name: 'email_host', label: 'SMTP 主机', type: 'text', span: 12 },
      { name: 'email_port', label: 'SMTP 端口', type: 'text', span: 12 },
      { name: 'email_username', label: 'SMTP 用户名', type: 'text', span: 12 },
      { name: 'email_password', label: 'SMTP 密码', type: 'password', span: 12 },
      { name: 'email_encryption', label: '加密方式', type: 'text', span: 12, help: 'ssl / tls，留空为不加密' },
      { name: 'email_from_address', label: '发件人地址', type: 'text', span: 12 },
      {
        name: 'email_template',
        label: '邮件模板',
        type: 'select',
        span: 12,
        help: '选项来自 resources/views/mail/ 下的目录',
      },
    ],
  },
  {
    key: 'telegram',
    title: 'Telegram',
    fields: [
      { name: 'telegram_bot_enable', label: '启用机器人', ...BOOL, span: 8 },
      { name: 'telegram_bot_token', label: 'Bot Token', type: 'password', span: 16 },
      { name: 'telegram_discuss_link', label: '交流群链接', type: 'text', span: 12, help: '必须是合法 URL' },
      {
        name: 'telegram_discuss_id',
        label: '交流群 ID',
        type: 'text',
        span: 6,
        help: '可写但 fetch 不返回，界面无法回显当前值',
      },
      {
        name: 'telegram_channel_id',
        label: '频道 ID',
        type: 'text',
        span: 6,
        help: '可写但 fetch 不返回，界面无法回显当前值',
      },
    ],
  },
  {
    key: 'frontend',
    title: '前台主题',
    fields: [
      {
        name: 'frontend_theme',
        label: '主题',
        type: 'select',
        span: 12,
        help: '选项来自 public/theme/ 下的目录',
      },
      { name: 'frontend_background_url', label: '背景图地址', type: 'text', span: 12, help: '必须是合法 URL' },
      {
        name: 'frontend_theme_sidebar',
        label: '侧栏配色',
        type: 'select',
        span: 8,
        options: [
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ],
      },
      {
        name: 'frontend_theme_header',
        label: '顶栏配色',
        type: 'select',
        span: 8,
        options: [
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ],
      },
      {
        name: 'frontend_theme_color',
        label: '主色',
        type: 'select',
        span: 8,
        options: [
          { value: 'default', label: '默认' },
          { value: 'darkblue', label: '深蓝' },
          { value: 'black', label: '黑色' },
          { value: 'green', label: '绿色' },
        ],
      },
    ],
  },
  {
    key: 'ticket',
    title: '工单',
    fields: [
      {
        name: 'ticket_status',
        label: '工单开放状态',
        type: 'select',
        options: [
          { value: 0, label: '所有人可提交' },
          { value: 1, label: '仅付费用户' },
          { value: 2, label: '关闭工单' },
        ],
      },
    ],
  },
  {
    key: 'deposit',
    title: '充值赠送',
    fields: [
      {
        name: 'deposit_bounus',
        label: '充值赠送阶梯',
        type: 'json',
        help: '数组，例如 [{"amount":100,"bounus":10}]。具体结构取决于 OrderService::getbounus 的读法',
      },
    ],
  },
  {
    key: 'app',
    title: '客户端版本',
    fields: [
      { name: 'windows_version', label: 'Windows 版本', type: 'text', span: 8 },
      { name: 'windows_download_url', label: 'Windows 下载地址', type: 'text', span: 16 },
      { name: 'macos_version', label: 'macOS 版本', type: 'text', span: 8 },
      { name: 'macos_download_url', label: 'macOS 下载地址', type: 'text', span: 16 },
      { name: 'android_version', label: 'Android 版本', type: 'text', span: 8 },
      { name: 'android_download_url', label: 'Android 下载地址', type: 'text', span: 16 },
    ],
  },
]

/** 所有在 schema 里声明过的字段名，用于找出「后端返回了但界面没管」的字段 */
export const DECLARED_FIELDS = new Set(
  CONFIG_GROUPS.flatMap((g) => g.fields.map((f) => f.name)),
)

/** 开关类字段：后端要 0/1，不是 true/false */
export const SWITCH_FIELDS = new Set(
  CONFIG_GROUPS.flatMap((g) =>
    g.fields.filter((f) => f.type === 'switch').map((f) => f.name),
  ),
)

/** 数组类字段 */
export const TAG_FIELDS = new Set(
  CONFIG_GROUPS.flatMap((g) =>
    g.fields.filter((f) => f.type === 'tags').map((f) => f.name),
  ),
)

/** JSON 类字段 */
export const JSON_FIELDS = new Set(
  CONFIG_GROUPS.flatMap((g) =>
    g.fields.filter((f) => f.type === 'json').map((f) => f.name),
  ),
)
