import { Tooltip, Typography } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import FilterBar, { type FilterFieldConfig } from '@/components/FilterBar'
import {
  USER_FILTER_CONDITIONS,
  type UserFilter,
  type UserFilterKey,
} from '@/api/user'

/**
 * 用户列表的过滤字段配置。
 *
 * 键白名单来自 UserFetch.php，多一个就 422。
 *
 * ⚠️ 单位：`transfer_enable` / `d` 的值后端会乘 1073741824 当 GB 处理
 * （UserController::filter()），所以输入框直接收 GB，不做换算。
 * 而 user/update 提交同名字段时是字节 —— 两处口径不同，别混用。
 *
 * ⚠️ 凭证类筛选：user/fetch 是 GET（后端路由定死，前端改不了），筛选值会以
 * `filter[0][value]=<完整 token>` 的形式和 secure_path 一起进 URL，
 * 落进 nginx access log、CDN/WAF 请求日志。token / uuid 本身就是订阅凭证，
 * 所以在输入框和已生效条件旁都提示一句，引导优先用邮箱或 ID 定位用户。
 */
const CREDENTIAL_PLACEHOLDER = '会写进访问日志，建议改用邮箱/ID'

/** 值属于订阅凭证、写进 URL 会进访问日志的筛选键 */
const CREDENTIAL_KEYS: readonly UserFilterKey[] = ['uuid', 'token']

const FIELDS: readonly FilterFieldConfig<UserFilterKey>[] = [
  { key: 'email', label: '邮箱', input: 'text' },
  { key: 'id', label: 'ID', input: 'number' },
  { key: 'transfer_enable', label: '总流量', input: 'number', unit: 'GB', placeholder: 'GB' },
  { key: 'd', label: '下行流量', input: 'number', unit: 'GB', placeholder: 'GB' },
  { key: 'device_limit', label: '设备数限制', input: 'number' },
  { key: 'expired_at', label: '到期时间', input: 'number', placeholder: 'unix 时间戳' },
  { key: 'plan_id', label: '套餐 ID', input: 'number' },
  {
    key: 'banned',
    label: '是否封禁',
    input: 'select',
    options: [
      { value: '1', label: '已封禁' },
      { value: '0', label: '正常' },
    ],
  },
  {
    key: 'is_admin',
    label: '是否管理员',
    input: 'select',
    options: [
      { value: '1', label: '是' },
      { value: '0', label: '否' },
    ],
  },
  { key: 'invite_by_email', label: '邀请人邮箱', input: 'text' },
  { key: 'invite_user_id', label: '邀请人 ID', input: 'number' },
  { key: 'uuid', label: 'UUID', input: 'text', placeholder: CREDENTIAL_PLACEHOLDER },
  { key: 'token', label: '订阅 Token', input: 'text', placeholder: CREDENTIAL_PLACEHOLDER },
  { key: 'remarks', label: '备注', input: 'text' },
]

interface Props {
  value: UserFilter[]
  onChange: (filters: UserFilter[]) => void
  onSearch: () => void
}

export default function UserFilterBar({ value, onChange, onSearch }: Props) {
  const hasCredentialFilter = value.some((f) => CREDENTIAL_KEYS.includes(f.key))
  return (
    <FilterBar<UserFilterKey>
      fields={FIELDS}
      conditions={USER_FILTER_CONDITIONS}
      value={value}
      onChange={(f) => onChange(f as UserFilter[])}
      onSearch={onSearch}
      extra={
        hasCredentialFilter ? (
          <Tooltip title="用户列表接口是 GET，筛选值会出现在请求 URL 里，被 nginx / CDN 的访问日志记录。Token / UUID 是订阅凭证，能看到日志的人可以直接拿它拉订阅。能用邮箱或 ID 定位时请优先用它们。">
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              <ExclamationCircleOutlined /> Token / UUID 会写进访问日志
            </Typography.Text>
          </Tooltip>
        ) : undefined
      }
    />
  )
}
