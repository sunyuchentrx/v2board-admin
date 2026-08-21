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
  /** 表单里占的列宽（24 栏制） */
  span?: number
  help?: string
}

/** 全部 8 种协议共有的字段 */
export const COMMON_FIELDS: ProtocolField[] = [
  { name: 'name', label: '节点名称', type: 'text', required: true, span: 12 },
  {
    name: 'rate',
    label: '倍率',
    type: 'number',
    required: true,
    span: 6,
    help: '流量计费倍率，1 = 正常',
  },
  {
    name: 'server_port',
    label: '连接端口',
    type: 'number',
    required: true,
    span: 6,
    help: '客户端实际连接的端口',
  },
  { name: 'host', label: '节点地址', type: 'text', required: true, span: 12 },
  {
    name: 'port',
    label: '监听端口',
    type: 'text',
    required: true,
    span: 12,
    placeholder: '443 或 10000-20000',
    help: '节点端后端监听的端口，可以是端口段',
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
      span: 8,
      options: [
        { value: 'tcp', label: 'tcp' },
        { value: 'ws', label: 'ws' },
        { value: 'grpc', label: 'grpc' },
      ],
    },
    { name: 'server_name', label: 'SNI', type: 'text', span: 8 },
    {
      name: 'allow_insecure',
      label: '允许不安全',
      type: 'switch',
      span: 8,
      help: '跳过 TLS 证书校验',
    },
    { name: 'network_settings', label: '传输配置', type: 'json', span: 24 },
  ],

  vmess: [
    { name: 'tls', label: '启用 TLS', type: 'switch', required: true, span: 8 },
    {
      name: 'network',
      label: '传输协议',
      type: 'select',
      required: true,
      span: 16,
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
    // ⚠️ 这四个是 camelCase，vmess 独有的历史命名
    { name: 'networkSettings', label: '传输配置 (networkSettings)', type: 'json', span: 12 },
    { name: 'tlsSettings', label: 'TLS 配置 (tlsSettings)', type: 'json', span: 12 },
    { name: 'ruleSettings', label: '规则配置 (ruleSettings)', type: 'json', span: 12 },
    { name: 'dnsSettings', label: 'DNS 配置 (dnsSettings)', type: 'json', span: 12 },
  ],

  tuic: [
    { name: 'server_name', label: 'SNI', type: 'text', span: 8 },
    // ⚠️ 这三个布尔在后端是 required|in:0,1（不是 nullable），必须始终提交 0/1
    { name: 'insecure', label: '允许不安全', type: 'switch', span: 8 },
    { name: 'disable_sni', label: '禁用 SNI', type: 'switch', span: 8 },
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
    { name: 'zero_rtt_handshake', label: '0-RTT 握手', type: 'switch', span: 8 },
  ],

  anytls: [
    { name: 'server_name', label: 'SNI', type: 'text', span: 12 },
    { name: 'insecure', label: '允许不安全', type: 'switch', span: 12 },
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
    { name: 'up_mbps', label: '上行 (Mbps)', type: 'number', span: 8 },
    { name: 'down_mbps', label: '下行 (Mbps)', type: 'number', span: 8 },
    { name: 'obfs', label: '混淆类型', type: 'text', span: 8 },
    { name: 'obfs_password', label: '混淆密码', type: 'text', span: 8 },
    { name: 'server_name', label: 'SNI', type: 'text', span: 8 },
    { name: 'insecure', label: '允许不安全', type: 'switch', span: 8 },
  ],

  vless: [
    {
      // ⚠️ 不是布尔！后端是 required|in:0,1,2（0 关闭 / 1 TLS / 2 Reality）
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
      // 后端 nullable|in:xtls-rprx-vision —— 只有这一个合法值
      options: [{ value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' }],
      help: '留空为不启用',
    },
    {
      name: 'network',
      label: '传输协议',
      type: 'select',
      required: true,
      span: 8,
      // vless 的 network 后端只校验 required，不限枚举，这里给常用值
      options: ['tcp', 'ws', 'grpc', 'http', 'httpupgrade', 'xhttp', 'kcp'].map(
        (v) => ({ value: v, label: v }),
      ),
    },
    { name: 'encryption', label: '加密', type: 'text', span: 8 },
    { name: 'tls_settings', label: 'TLS 配置', type: 'json', span: 16 },
    { name: 'network_settings', label: '传输配置', type: 'json', span: 12 },
    { name: 'encryption_settings', label: '加密配置', type: 'json', span: 12 },
  ],

  /**
   * v2node 是「统一节点」类型，字段是其它协议的超集
   * （由 protocol 字段决定实际生效哪些）。
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
      help: '留空为不启用',
    },
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
    { name: 'encryption', label: '加密', type: 'text', span: 8 },
    { name: 'cipher', label: 'SS 加密方式', type: 'text', span: 8 },
    { name: 'up_mbps', label: '上行 (Mbps)', type: 'number', span: 8 },
    { name: 'down_mbps', label: '下行 (Mbps)', type: 'number', span: 8 },
    { name: 'obfs', label: '混淆类型', type: 'text', span: 8 },
    { name: 'obfs_password', label: '混淆密码', type: 'text', span: 8 },
    { name: 'disable_sni', label: '禁用 SNI', type: 'switch', span: 8 },
    { name: 'zero_rtt_handshake', label: '0-RTT 握手', type: 'switch', span: 8 },
    {
      name: 'udp_relay_mode',
      label: 'UDP 中继模式',
      type: 'text',
      span: 8,
    },
    { name: 'congestion_control', label: '拥塞控制', type: 'text', span: 8 },
    { name: 'tls_settings', label: 'TLS 配置', type: 'json', span: 12 },
    { name: 'network_settings', label: '传输配置', type: 'json', span: 12 },
    { name: 'encryption_settings', label: '加密配置', type: 'json', span: 12 },
    { name: 'padding_scheme', label: '填充方案', type: 'textarea', span: 12 },
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
