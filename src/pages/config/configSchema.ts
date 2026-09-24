import type { FormRule } from 'antd'
import { securePath } from '@/settings'

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
  /**
   * 前端预校验，照 ConfigSave::rules() 抄。
   * 不是为了替代后端（后端 422 会逐字段落到表单上），而是因为 ConfigSave 是整单校验：
   * 任何一个字段不合法，同一次提交里的所有改动（包括安全开关）都不会写入，提前拦住更稳。
   * 值为 undefined 时一律放行 —— 那表示没回填也没改过，buildPayload 根本不会提交它。
   */
  rules?: FormRule[]
  /** 只在 fetch 里出现、不在 save 白名单里 —— 展示但不可编辑 */
  readonly?: boolean
  /** 改动后影响面很大，需要额外确认 */
  dangerous?: boolean

  // ───── 以下全是展示用属性，不影响提交与校验 ─────

  /**
   * 宽屏下占 24 栅格里的几格（24 / 16 / 12 / 8）。窄屏自动折成整行，见 ConfigPage 的 colProps。
   * 开关不看它：开关统一渲染成 SettingSwitch 卡片，按同组开关数量排列。
   */
  span?: number
  /** 从这个字段开始一个新的小节（FormSection）。只写在小节的第一个字段上 */
  section?: { title: string; description?: string }
  /** 数值单位，渲染成输入框后缀；label 里不要再写一遍 */
  unit?: string
  placeholder?: string
  /**
   * help 放在哪。默认：整行字段放在输入框下方（extra），半行字段放进 label 旁的问号 ——
   * 同一行里只有部分字段带 extra 会把那一项撑高、下一行错位。
   * 同一行的字段都有 help 时可以显式写 'extra'。开关的 help 一律作为卡片里的说明文字。
   */
  helpAs?: 'extra' | 'tooltip'
  /** 可写但 fetch 不回显 —— label 旁标一个「不回显」 */
  writeOnly?: boolean
}

export interface ConfigGroup {
  /** 与 fetch 返回的分组键一致 */
  key: string
  title: string
  /** 展示在分组卡片标题下方 */
  description?: string
  fields: ConfigField[]
}

const BOOL: Pick<ConfigField, 'type'> = { type: 'switch' }

/**
 * ConfigSave::rules() 里 deposit_bounus 闭包对每一项用的正则，原样照抄。
 * 读取方 OrderService::getbounus 是 `list($amount, $bounus) = explode(':', $tier)`，
 * 两段都按「元」乘 100 转成分，所以每项必须是 "充值金额:赠送金额" 字符串。
 */
const DEPOSIT_TIER = /^\d+(\.\d+)?:\d+(\.\d+)?$/

/**
 * 校验「充值赠送阶梯」文本域里的 JSON。
 *
 * 空项（null / ''）不报错：它们是原版后台留下的「不赠送」写法，由 stripEmptyTiers 在提交前剔除
 * （getbounus 对空项 explode 只得到一段，混在非空项里会 Undefined array key → 充值下单 500，所以不能原样提交）。
 * 另外对象/数字项在 PHP 8 下会让 preg_match 抛 TypeError（500 而不是 422），也必须前端拦住。
 */
/**
 * 剔除阶梯里的空项（null / ''）。
 *
 * 原版后台清空文本域时提交的是 `['']`，经 ConvertEmptyStringsToNull 落盘成 `[null]`；
 * 后端 getbounus 用 `$deposit_bounus[0] === null` 把它当「不赠送」。所以很多站点线上值就是
 * `[null]` —— 它合法，但不能再把空项原样写回去（与非空项混在一起时 explode 会炸）。
 * 回填、校验、提交三处都先过一遍这个函数：空项既不报错，也不提交。
 */
export function stripEmptyTiers(list: unknown[]): unknown[] {
  return list.filter((tier) => tier !== null && tier !== '')
}

async function validateDepositBounus(_: unknown, value: unknown) {
  if (value === undefined || value === null) return
  // 留空 = 不赠送，buildPayload 会提交 []
  if (typeof value !== 'string' || value.trim() === '') return
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('不是合法的 JSON，格式应为 ["100:10","200:30"]')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('必须是数组，格式应为 ["100:10","200:30"]')
  }
  stripEmptyTiers(parsed).forEach((tier, i) => {
    if (typeof tier !== 'string' || !DEPOSIT_TIER.test(tier)) {
      throw new Error(
        `第 ${i + 1} 项 ${JSON.stringify(tier)} 不合法：每项必须是 "充值金额:赠送金额" 字符串，例如 "100:10"`,
      )
    }
  })
}

export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    key: 'site',
    title: '站点',
    description: '站点名称、访问地址、注册开关与试用',
    fields: [
      { name: 'app_name', label: '站点名称', type: 'text', span: 12, section: { title: '基本信息' } },
      { name: 'app_description', label: '站点描述', type: 'text', span: 12 },
      { name: 'logo', label: 'Logo 地址', type: 'text', span: 12, help: '必须是合法 URL' },
      { name: 'tos_url', label: '服务条款地址', type: 'text', span: 12, help: '必须是合法 URL' },
      { name: 'currency', label: '货币代码', type: 'text', span: 12, placeholder: '例如 CNY' },
      { name: 'currency_symbol', label: '货币符号', type: 'text', span: 12, placeholder: '例如 ¥' },
      {
        name: 'app_url',
        label: '站点地址',
        type: 'text',
        help: '必须是合法 URL（nullable|url），影响邮件里的链接与安全模式判定',
        section: { title: '访问与订阅地址' },
      },
      {
        name: 'subscribe_url',
        label: '订阅地址',
        type: 'text',
        span: 12,
        help: '多个用英文逗号分隔，后端会随机取一个下发',
      },
      {
        name: 'subscribe_path',
        label: '订阅路径',
        type: 'text',
        span: 12,
        help: '必须以 / 开头（regex:/^\\//）',
        // 后端 nullable|regex:/^\//：留空可以，填了就必须以 / 开头
        rules: [
          {
            validator: async (_, value) => {
              if (value === undefined || value === null || value === '') return
              if (typeof value !== 'string' || !value.startsWith('/')) {
                throw new Error('订阅路径必须以 / 开头')
              }
            },
          },
        ],
      },
      {
        name: 'force_https',
        label: '强制 HTTPS',
        ...BOOL,
        help: '后端生成的链接一律用 https；HTTPS 在反代上终止、PHP 收到的是 http 请求时开启',
      },
      {
        name: 'stop_register',
        label: '停止注册',
        ...BOOL,
        help: '开启后不再接受新用户注册',
        section: { title: '注册与试用' },
      },
      {
        name: 'try_out_enable',
        label: '开启试用',
        ...BOOL,
        writeOnly: true,
        help: '注意：这个字段可写但 fetch 不返回，界面上无法回显当前值（显示关闭不代表服务器上是关闭）。不去拨动就不会提交，服务器上的原值保持不变',
      },
      { name: 'try_out_plan_id', label: '试用套餐 ID', type: 'number', span: 12 },
      { name: 'try_out_hour', label: '试用时长', type: 'number', span: 12, unit: '小时' },
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
        section: { title: '访问控制' },
        help: '至少 8 位，只能是字母数字下划线和连字符。改了之后旧地址立即失效，新后台入口变成 /{新路径}/v2，管理接口前缀也一起变',
        // 后端 min:8|regex:/^[\w-]*$/，没有 nullable：清空（空串被 Laravel 转成 null）同样 422
        rules: [
          {
            validator: async (_, value) => {
              // 没改动时 buildPayload 不提交它，也就不必校验：线上现存的路径未必满足 min:8
              // （例如沿用旧版 frontend_admin_path），不能因此卡住其它所有配置的保存
              if (value === undefined || value === securePath) return
              if (typeof value !== 'string' || value.length < 8) {
                throw new Error('后台路径至少 8 位')
              }
              if (!/^[\w-]*$/.test(value)) {
                throw new Error('后台路径只能包含字母、数字、下划线和连字符')
              }
            },
          },
        ],
      },
      { name: 'safe_mode_enable', label: '安全模式', ...BOOL, help: '开启后只允许通过站点地址的域名访问' },
      {
        name: 'email_verify',
        label: '邮箱验证',
        ...BOOL,
        help: '注册时要求填写邮箱验证码',
        section: { title: '注册邮箱' },
      },
      {
        name: 'email_whitelist_enable',
        label: '邮箱后缀白名单',
        ...BOOL,
        help: '只允许下方列出的邮箱后缀注册',
      },
      {
        name: 'email_gmail_limit_enable',
        label: '限制 Gmail 别名',
        ...BOOL,
        help: '拒绝邮箱前缀含 . 或 + 的地址注册',
      },
      {
        name: 'email_whitelist_suffix',
        label: '允许的邮箱后缀',
        type: 'tags',
        help: '不含 @，例如 gmail.com',
      },
      {
        name: 'recaptcha_enable',
        label: '开启人机验证',
        ...BOOL,
        help: '本 fork 用的是 Cloudflare Turnstile',
        section: { title: '人机验证' },
      },
      { name: 'recaptcha_key', label: '验证密钥 (Secret)', type: 'password', span: 12 },
      { name: 'recaptcha_site_key', label: '验证站点密钥 (Site Key)', type: 'text', span: 12 },
      {
        name: 'register_limit_by_ip_enable',
        label: '按 IP 限制注册',
        ...BOOL,
        help: '同一 IP 在限制时长内注册次数达到上限后拒绝注册',
        section: { title: '注册频率' },
      },
      { name: 'register_limit_count', label: '同 IP 注册上限', type: 'number', span: 12, unit: '次' },
      { name: 'register_limit_expire', label: '注册限制时长', type: 'number', span: 12, unit: '分钟' },
      {
        name: 'password_limit_enable',
        label: '限制密码错误次数',
        ...BOOL,
        help: '密码连续输错达到次数后，在锁定时长内禁止登录',
        section: { title: '密码错误锁定' },
      },
      { name: 'password_limit_count', label: '允许错误次数', type: 'number', span: 12, unit: '次' },
      { name: 'password_limit_expire', label: '锁定时长', type: 'number', span: 12, unit: '分钟' },
    ],
  },
  {
    key: 'subscribe',
    title: '订阅',
    description: '套餐变更、流量重置与订阅内容下发',
    fields: [
      {
        name: 'plan_change_enable',
        label: '允许更改订阅',
        ...BOOL,
        help: '允许用户自行更换套餐',
        section: { title: '套餐与流量' },
      },
      {
        name: 'surplus_enable',
        label: '启用旧订单折抵',
        ...BOOL,
        help: '更换套餐时用旧订单的剩余价值抵扣',
      },
      {
        name: 'allow_new_period',
        label: '允许新周期',
        ...BOOL,
        help: '流量用尽时允许用户提前开始下一个重置周期',
      },
      {
        name: 'reset_traffic_method',
        label: '流量重置方式',
        type: 'select',
        span: 12,
        options: [
          { value: 0, label: '每月 1 号' },
          { value: 1, label: '按购买日期' },
          { value: 2, label: '不重置' },
          { value: 3, label: '每年 1 月 1 号' },
          { value: 4, label: '按年重置' },
        ],
      },
      {
        name: 'show_subscribe_method',
        label: '订阅地址形式',
        type: 'select',
        span: 12,
        section: { title: '订阅下发' },
        options: [
          { value: 0, label: '带 token 查询参数' },
          { value: 1, label: '形式 1' },
          { value: 2, label: '形式 2' },
        ],
      },
      { name: 'show_subscribe_expire', label: '订阅到期提前提醒', type: 'number', span: 12, unit: '天' },
      {
        name: 'show_info_to_server_enable',
        label: '向节点下发用户信息',
        ...BOOL,
        help: '在订阅的节点列表顶部插入剩余流量、到期时间等信息',
      },
      {
        name: 'new_order_event_id',
        label: '新购事件',
        ...BOOL,
        section: {
          title: '订单事件',
          description: '开启后，对应类型的订单开通时会重置用户已用流量',
        },
      },
      { name: 'renew_order_event_id', label: '续费事件', ...BOOL },
      { name: 'change_order_event_id', label: '变更事件', ...BOOL },
    ],
  },
  {
    key: 'invite',
    title: '邀请与佣金',
    description: '邀请注册、返佣规则与提现',
    fields: [
      {
        name: 'invite_force',
        label: '强制邀请注册',
        ...BOOL,
        help: '没有有效邀请码不能注册',
        section: { title: '邀请' },
      },
      {
        name: 'invite_never_expire',
        label: '邀请码永不过期',
        ...BOOL,
        help: '邀请码被使用后不失效，可以重复使用',
      },
      { name: 'invite_commission', label: '默认佣金比例', type: 'number', span: 12, unit: '%' },
      { name: 'invite_gen_limit', label: '每人邀请码上限', type: 'number', span: 12 },
      {
        name: 'commission_first_time_enable',
        label: '仅首单返佣',
        ...BOOL,
        help: '只在被邀请人首次付款时产生佣金',
        section: { title: '佣金与提现' },
      },
      {
        name: 'commission_auto_check_enable',
        label: '自动确认佣金',
        ...BOOL,
        help: '订单完成 3 天后自动确认佣金',
      },
      {
        name: 'withdraw_close_enable',
        label: '关闭提现',
        ...BOOL,
        help: '开启后不能申请提现，佣金直接发放到余额',
      },
      { name: 'commission_withdraw_limit', label: '提现门槛', type: 'number', span: 12, unit: '元' },
      {
        name: 'commission_withdraw_method',
        label: '提现方式',
        type: 'tags',
        span: 12,
        help: '例如 支付宝、USDT',
      },
      {
        name: 'commission_distribution_enable',
        label: '启用三级分销',
        ...BOOL,
        help: '按下面的比例把佣金分给三级上级邀请人',
        section: { title: '三级分销' },
      },
      { name: 'commission_distribution_l1', label: '一级比例', type: 'number', span: 8, unit: '%' },
      { name: 'commission_distribution_l2', label: '二级比例', type: 'number', span: 8, unit: '%' },
      { name: 'commission_distribution_l3', label: '三级比例', type: 'number', span: 8, unit: '%' },
    ],
  },
  {
    key: 'server',
    title: '节点通信',
    description: '节点端（V2bX / v2node）与面板对接的参数',
    fields: [
      {
        name: 'server_token',
        label: '通信密钥',
        type: 'password',
        dangerous: true,
        section: { title: '对接' },
        help: '至少 16 位。改了之后所有节点都要同步更新配置，否则会全部掉线',
        // 后端 nullable|min:16：留空可以，填了就至少 16 位
        rules: [
          {
            validator: async (_, value) => {
              if (value === undefined || value === null || value === '') return
              if (typeof value !== 'string' || [...value].length < 16) {
                throw new Error('通信密钥至少 16 位')
              }
            },
          },
        ],
      },
      { name: 'server_api_url', label: '节点 API 地址', type: 'text' },
      {
        name: 'server_pull_interval',
        label: '拉取间隔',
        type: 'number',
        span: 8,
        unit: '秒',
        section: { title: '同步与上报' },
      },
      { name: 'server_push_interval', label: '上报间隔', type: 'number', span: 8, unit: '秒' },
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
    description: '发送验证码与通知邮件用的 SMTP 配置',
    fields: [
      { name: 'email_host', label: 'SMTP 主机', type: 'text', span: 12, section: { title: 'SMTP' } },
      { name: 'email_port', label: 'SMTP 端口', type: 'text', span: 12 },
      { name: 'email_username', label: 'SMTP 用户名', type: 'text', span: 12 },
      { name: 'email_password', label: 'SMTP 密码', type: 'password', span: 12 },
      {
        name: 'email_encryption',
        label: '加密方式',
        type: 'text',
        span: 12,
        help: 'ssl / tls，留空为不加密',
        placeholder: '留空为不加密',
      },
      { name: 'email_from_address', label: '发件人地址', type: 'text', span: 12 },
      {
        name: 'email_template',
        label: '邮件模板',
        type: 'select',
        span: 12,
        help: '选项来自 resources/views/mail/ 下的目录',
        section: { title: '模板' },
      },
    ],
  },
  {
    key: 'telegram',
    title: 'Telegram',
    description: 'Telegram 机器人、交流群与频道',
    fields: [
      {
        name: 'telegram_bot_enable',
        label: '启用机器人',
        ...BOOL,
        help: '用户端显示绑定 Telegram 的入口；收款、工单、节点离线等通知推送给已绑定的管理员',
        section: { title: '机器人' },
      },
      { name: 'telegram_bot_token', label: 'Bot Token', type: 'password' },
      {
        name: 'telegram_discuss_link',
        label: '交流群链接',
        type: 'text',
        help: '必须是合法 URL',
        section: { title: '交流群与频道' },
      },
      {
        name: 'telegram_discuss_id',
        label: '交流群 ID',
        type: 'text',
        span: 12,
        writeOnly: true,
        helpAs: 'extra',
        help: '可写但 fetch 不返回，界面无法回显当前值',
      },
      {
        name: 'telegram_channel_id',
        label: '频道 ID',
        type: 'text',
        span: 12,
        writeOnly: true,
        helpAs: 'extra',
        help: '可写但 fetch 不返回，界面无法回显当前值',
      },
    ],
  },
  {
    key: 'frontend',
    title: '前台主题',
    description: '用户前台的主题、背景与配色',
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
    description: '控制哪些用户可以提交工单',
    fields: [
      {
        name: 'ticket_status',
        label: '工单开放状态',
        type: 'select',
        span: 12,
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
    description: '用户充值余额时按阶梯赠送',
    fields: [
      {
        name: 'deposit_bounus',
        label: '充值赠送阶梯',
        type: 'json',
        placeholder: '["100:10","200:30"]',
        help: '字符串数组，每项是 "充值金额:赠送金额"（单位元，可带小数），例如 ["100:10","200:30"] 表示充满 100 送 10、充满 200 送 30，取满足门槛的最高一档。留空表示不赠送',
        rules: [{ validator: validateDepositBounus }],
      },
    ],
  },
  {
    key: 'app',
    title: '客户端版本',
    description: '客户端检查更新时读取的版本号与下载地址',
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

/** 字段名 → 所在分组 key。校验失败时用它切到出错字段所在的标签页 */
export const FIELD_GROUP = new Map(
  CONFIG_GROUPS.flatMap((g) => g.fields.map((f) => [f.name, g.key] as const)),
)

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
