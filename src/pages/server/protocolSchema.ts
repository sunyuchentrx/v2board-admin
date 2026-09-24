import type { ServerProtocol } from '@/api/server'

/**
 * 8 种协议的表单字段 schema。
 *
 * 为什么用 schema 驱动而不是手写 8 个表单：8 个协议控制器结构完全一致
 * （save/drop/update/copy），差别只在字段集，而字段集有大量重叠
 * （id/group_id/route_id/parent_id/tags/name/rate/host/port/server_port/show/sort
 * 是全部 8 个共有的）。手写会产生 8 份几乎相同的表单代码。
 *
 * 字段来源：
 *   - 共有字段取自各表结构的交集（实测 8 张 v2_server_* 表）
 *   - 协议特有字段取自各自的校验规则：
 *       shadowsocks / trojan / vmess → ServerXxxSave.php
 *       tuic / anytls / hysteria / vless / v2node → 控制器内联 $request->validate()
 *
 * ⚠️ vmess 的字段名是 **camelCase**（networkSettings / tlsSettings /
 * ruleSettings / dnsSettings），其它协议是 snake_case（network_settings 等）。
 * 这是后端的历史不一致，不是笔误，照抄即可。
 *
 * 版式约定（NodeEditModal 按这些提示排版，改动它们不影响提交的数据）：
 *   - 普通控件（text / number / select）排在一个栅格里，`span` 是它在 md 及以上的列宽，
 *     同一分组内各行的 span 之和要凑满 24，保证每行左右对齐
 *   - 开关（switch）单独成行，渲染成 SettingSwitch 卡片，`help` 作为卡片里的说明
 *   - JSON / 多行文本默认归入「高级配置」小节，整行宽
 *   - 普通控件的 `help` 显示成标签旁的问号提示（不用 extra，免得把同一行的某一项撑高）
 */

export type FieldType =
  | 'text'
  | 'number'
  | 'switch'
  /** 单选，需要 options */
  | 'select'
  /** 任意 JSON 对象/数组，用文本域编辑 */
  | 'json'
  /** 多行纯文本 */
  | 'textarea'

export interface ProtocolField {
  name: string
  label: string
  type: FieldType
  required?: boolean
  options?: { value: string | number; label: string }[]
  placeholder?: string
  /** 表单里占的列宽（24 栏制，md 及以上；手机上一律整行） */
  span?: number
  help?: string
  /** 数值字段的单位，显示在输入框尾部（纯展示） */
  unit?: string
  /** 归入哪个分组小节（见 PROTOCOL_GROUPS）；不填则按类型自动归组（纯展示） */
  group?: string
}

/** 全部 8 种协议共有的字段 */
export const COMMON_FIELDS: ProtocolField[] = [
  { name: 'name', label: '节点名称', type: 'text', required: true, span: 12 },
  { name: 'host', label: '节点地址', type: 'text', required: true, span: 12 },
  // ⚠️ port / server_port 的含义别弄反（和 v2board 原版后台一致，
  //    ServerXxxSave.php 的报错文案就是「连接端口不能为空」/「后端服务端口不能为空」）：
  //   port        → 下发到订阅里、客户端连接的端口（可以是端口段，用于端口跳跃；中转节点填中转入口端口）
  //   server_port → 节点后端（UniProxy config）实际监听的端口
  {
    name: 'port',
    label: '连接端口',
    type: 'text',
    required: true,
    span: 8,
    placeholder: '443 或 10000-20000',
    help: '客户端连接的端口（写进订阅）\n可填端口段；中转节点填入口端口',
  },
  {
    name: 'server_port',
    label: '服务端口',
    type: 'number',
    required: true,
    span: 8,
    help: '节点后端实际监听的端口',
  },
  {
    name: 'rate',
    label: '倍率',
    type: 'number',
    required: true,
    span: 8,
    unit: '倍',
    help: '流量计费倍率，1 = 正常',
  },
]

/** 各协议特有的字段 */
export const PROTOCOL_FIELDS: Record<ServerProtocol, ProtocolField[]> = {
  shadowsocks: [
    {
      name: 'cipher',
      label: '加密方式',
      type: 'select',
      required: true,
      span: 12,
      // 白名单来自 ServerShadowsocksSave.php 的 in:...
      options: [
        { value: 'aes-128-gcm', label: 'aes-128-gcm' },
        { value: 'aes-192-gcm', label: 'aes-192-gcm' },
        { value: 'aes-256-gcm', label: 'aes-256-gcm' },
        { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305' },
        { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
        { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' },
      ],
    },
    {
      name: 'obfs',
      label: '混淆',
      type: 'select',
      span: 12,
      // 后端只允许 http（nullable|in:http）
      options: [{ value: 'http', label: 'http' }],
      placeholder: '不混淆',
      help: '后端只支持 http，留空为不混淆',
    },
    { name: 'obfs_settings', label: '混淆配置', type: 'json', span: 24 },
  ],

  trojan: [
    {
      name: 'network',
      label: '传输协议',
      type: 'select',
      required: true,
      span: 12,
      options: [
        { value: 'tcp', label: 'tcp' },
        { value: 'ws', label: 'ws' },
        { value: 'grpc', label: 'grpc' },
      ],
    },
    { name: 'server_name', label: 'SNI', type: 'text', span: 12 },
    {
      name: 'allow_insecure',
      label: '允许不安全',
      type: 'switch',
      span: 12,
      help: '跳过 TLS 证书校验',
    },
    { name: 'network_settings', label: '传输配置', type: 'json', span: 24 },
  ],

  vmess: [
    {
      name: 'tls',
      label: '启用 TLS',
      type: 'switch',
      required: true,
      span: 12,
      help: '节点使用 TLS 传输',
    },
    {
      name: 'network',
      label: '传输协议',
      type: 'select',
      required: true,
      // 这一节唯一的普通控件，整行宽（下面的「启用 TLS」开关也是整行）
      span: 24,
      // 白名单来自 ServerVmessSave.php
      options: [
        'tcp',
        'kcp',
        'ws',
        'http',
        'domainsocket',
        'quic',
        'grpc',
        'httpupgrade',
        'xhttp',
      ].map((v) => ({ value: v, label: v })),
    },
    // ⚠️ 这四个是 camelCase，vmess 独有的历史命名（表单里 JSON 字段会在标签旁显示字段名）
    { name: 'networkSettings', label: '传输配置', type: 'json', span: 24 },
    { name: 'tlsSettings', label: 'TLS 配置', type: 'json', span: 24 },
    { name: 'ruleSettings', label: '规则配置', type: 'json', span: 24 },
    { name: 'dnsSettings', label: 'DNS 配置', type: 'json', span: 24 },
  ],

  tuic: [
    { name: 'server_name', label: 'SNI', type: 'text', span: 8 },
    {
      name: 'udp_relay_mode',
      label: 'UDP 中继模式',
      type: 'select',
      span: 8,
      options: [
        { value: 'native', label: 'native' },
        { value: 'quic', label: 'quic' },
      ],
    },
    {
      name: 'congestion_control',
      label: '拥塞控制',
      type: 'select',
      span: 8,
      options: [
        { value: 'bbr', label: 'bbr' },
        { value: 'cubic', label: 'cubic' },
        { value: 'new_reno', label: 'new_reno' },
      ],
    },
    // ⚠️ 这三个布尔在后端是 required|in:0,1（不是 nullable），必须始终提交 0/1
    {
      name: 'insecure',
      label: '允许不安全',
      type: 'switch',
      span: 8,
      help: '跳过 TLS 证书校验',
    },
    {
      name: 'disable_sni',
      label: '禁用 SNI',
      type: 'switch',
      span: 8,
      help: '握手时不发送 SNI',
    },
    {
      name: 'zero_rtt_handshake',
      label: '0-RTT 握手',
      type: 'switch',
      span: 8,
      help: '降低握手延迟',
    },
  ],

  anytls: [
    { name: 'server_name', label: 'SNI', type: 'text', span: 12 },
    {
      name: 'insecure',
      label: '允许不安全',
      type: 'switch',
      span: 12,
      help: '跳过 TLS 证书校验',
    },
    {
      name: 'padding_scheme',
      label: '填充方案',
      type: 'textarea',
      span: 24,
      help: '每行一条规则',
    },
  ],

  hysteria: [
    {
      name: 'version',
      label: '版本',
      type: 'select',
      required: true,
      span: 8,
      options: [
        { value: 1, label: 'Hysteria 1' },
        { value: 2, label: 'Hysteria 2' },
      ],
    },
    { name: 'up_mbps', label: '上行带宽', type: 'number', span: 8, unit: 'Mbps' },
    { name: 'down_mbps', label: '下行带宽', type: 'number', span: 8, unit: 'Mbps' },
    { name: 'obfs', label: '混淆类型', type: 'text', span: 8 },
    { name: 'obfs_password', label: '混淆密码', type: 'text', span: 8 },
    { name: 'server_name', label: 'SNI', type: 'text', span: 8 },
    {
      name: 'insecure',
      label: '允许不安全',
      type: 'switch',
      span: 8,
      help: '跳过 TLS 证书校验',
    },
  ],

  vless: [
    {
      // ⚠️ 不是布尔！后端是 required|in:0,1,2（0 关闭 / 1 TLS / 2 Reality）
      name: 'tls',
      label: 'TLS 模式',
      type: 'select',
      required: true,
      span: 12,
      options: [
        { value: 0, label: '关闭' },
        { value: 1, label: 'TLS' },
        { value: 2, label: 'Reality' },
      ],
    },
    {
      name: 'flow',
      label: 'Flow',
      type: 'select',
      span: 12,
      // 后端 nullable|in:xtls-rprx-vision —— 只有这一个合法值
      options: [{ value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' }],
      placeholder: '不启用',
      help: '留空为不启用',
    },
    {
      name: 'network',
      label: '传输协议',
      type: 'select',
      required: true,
      span: 12,
      // vless 的 network 后端只校验 required，不限枚举，这里给常用值
      options: ['tcp', 'ws', 'grpc', 'http', 'httpupgrade', 'xhttp', 'kcp'].map(
        (v) => ({ value: v, label: v }),
      ),
    },
    { name: 'encryption', label: '加密', type: 'text', span: 12 },
    { name: 'tls_settings', label: 'TLS 配置', type: 'json', span: 24 },
    { name: 'network_settings', label: '传输配置', type: 'json', span: 24 },
    { name: 'encryption_settings', label: '加密配置', type: 'json', span: 24 },
  ],

  /**
   * v2node 是「统一节点」类型，字段是其它协议的超集
   * （由 protocol 字段决定实际生效哪些）。
   * 表单里按「对哪个协议生效」分组（group），见 PROTOCOL_GROUPS.v2node。
   */
  v2node: [
    {
      name: 'protocol',
      label: '协议',
      type: 'select',
      required: true,
      span: 8,
      // ⚠️ 白名单里是 **hysteria2**（带 2），不是 hysteria。
      // 来自 V2nodeController 的 in:shadowsocks,vmess,vless,trojan,tuic,hysteria2,anytls
      options: [
        'shadowsocks',
        'vmess',
        'vless',
        'trojan',
        'tuic',
        'hysteria2',
        'anytls',
      ].map((v) => ({ value: v, label: v })),
      help: '决定下面哪些字段生效',
    },
    { name: 'listen_ip', label: '监听 IP', type: 'text', span: 8 },
    {
      name: 'network',
      label: '传输协议',
      type: 'select',
      required: true,
      span: 8,
      // required|in:tcp,ws,grpc,http,httpupgrade,xhttp —— 没有 kcp
      options: ['tcp', 'ws', 'grpc', 'http', 'httpupgrade', 'xhttp'].map((v) => ({
        value: v,
        label: v,
      })),
    },
    {
      // ⚠️ 不是布尔！required|in:0,1,2
      name: 'tls',
      label: 'TLS 模式',
      type: 'select',
      required: true,
      span: 8,
      options: [
        { value: 0, label: '关闭' },
        { value: 1, label: 'TLS' },
        { value: 2, label: 'Reality' },
      ],
    },
    {
      name: 'flow',
      label: 'Flow',
      type: 'select',
      span: 8,
      // nullable|in:xtls-rprx-vision
      options: [{ value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' }],
      placeholder: '不启用',
      help: '留空为不启用',
    },
    { name: 'encryption', label: '加密', type: 'text', span: 8 },
    {
      name: 'up_mbps',
      label: '上行带宽',
      type: 'number',
      span: 12,
      unit: 'Mbps',
      group: 'hysteria2',
    },
    {
      name: 'down_mbps',
      label: '下行带宽',
      type: 'number',
      span: 12,
      unit: 'Mbps',
      group: 'hysteria2',
    },
    { name: 'obfs', label: '混淆类型', type: 'text', span: 12, group: 'hysteria2' },
    {
      name: 'obfs_password',
      label: '混淆密码',
      type: 'text',
      span: 12,
      group: 'hysteria2',
    },
    {
      name: 'udp_relay_mode',
      label: 'UDP 中继模式',
      type: 'text',
      span: 12,
      group: 'tuic',
    },
    {
      name: 'congestion_control',
      label: '拥塞控制',
      type: 'text',
      span: 12,
      group: 'tuic',
    },
    {
      name: 'disable_sni',
      label: '禁用 SNI',
      type: 'switch',
      span: 12,
      help: '握手时不发送 SNI',
      group: 'tuic',
    },
    {
      name: 'zero_rtt_handshake',
      label: '0-RTT 握手',
      type: 'switch',
      span: 12,
      help: '降低握手延迟',
      group: 'tuic',
    },
    {
      name: 'cipher',
      label: 'SS 加密方式',
      type: 'text',
      span: 12,
      group: 'ss-anytls',
    },
    {
      name: 'padding_scheme',
      label: '填充方案',
      type: 'textarea',
      span: 24,
      help: '每行一条规则',
      group: 'ss-anytls',
    },
    { name: 'tls_settings', label: 'TLS 配置', type: 'json', span: 24 },
    { name: 'network_settings', label: '传输配置', type: 'json', span: 24 },
    { name: 'encryption_settings', label: '加密配置', type: 'json', span: 24 },
  ],
}

/** 表单分组小节（纯展示）。字段通过 ProtocolField.group 归入，顺序即小节顺序 */
export interface FieldGroup {
  key: string
  title: string
  description?: string
}

/**
 * 各协议额外的分组小节，排在「XX 配置」之后、「高级配置」之前。
 * 只有字段多、且字段对不同子协议生效的 v2node 需要。
 */
export const PROTOCOL_GROUPS: Partial<Record<ServerProtocol, FieldGroup[]>> = {
  v2node: [
    { key: 'hysteria2', title: 'Hysteria2', description: '仅在「协议」为 hysteria2 时生效' },
    { key: 'tuic', title: 'TUIC', description: '仅在「协议」为 tuic 时生效' },
    {
      key: 'ss-anytls',
      title: 'Shadowsocks / AnyTLS',
      description: '加密方式对 shadowsocks 生效，填充方案对 anytls 生效',
    },
  ],
}

/** 协议的中文显示名 */
export const PROTOCOL_LABELS: Record<ServerProtocol, string> = {
  shadowsocks: 'Shadowsocks',
  trojan: 'Trojan',
  vmess: 'VMess',
  tuic: 'TUIC',
  anytls: 'AnyTLS',
  hysteria: 'Hysteria',
  vless: 'VLESS',
  v2node: 'V2node（统一节点）',
}

/** 列表 / 标签里用的短名（v2node 去掉括号说明） */
export const PROTOCOL_SHORT_LABELS: Record<ServerProtocol, string> = {
  ...PROTOCOL_LABELS,
  v2node: 'V2node',
}

/**
 * 协议标签色（antd 预设色，暗色模式自动适配）。全站同一协议同一种颜色。
 * 8 个色相尽量拉开（VMess / VLESS 名字像，颜色刻意分得很开）。
 */
export const PROTOCOL_COLORS: Record<ServerProtocol, string> = {
  shadowsocks: 'purple',
  trojan: 'volcano',
  vmess: 'cyan',
  tuic: 'lime',
  anytls: 'gold',
  hysteria: 'magenta',
  vless: 'geekblue',
  v2node: 'green',
}

/** 哪些字段是 JSON 类型 —— 提交前要 parse，回填时要 stringify */
export function jsonFieldNames(protocol: ServerProtocol): string[] {
  return [
    ...COMMON_FIELDS,
    ...PROTOCOL_FIELDS[protocol],
  ]
    .filter((f) => f.type === 'json')
    .map((f) => f.name)
}

/** 哪些字段是开关 —— 后端要 0/1 而不是 true/false */
export function switchFieldNames(protocol: ServerProtocol): string[] {
  return [...COMMON_FIELDS, ...PROTOCOL_FIELDS[protocol]]
    .filter((f) => f.type === 'switch')
    .map((f) => f.name)
}
