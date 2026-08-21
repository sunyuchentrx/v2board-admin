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
 */
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
  { key: 'uuid', label: 'UUID', input: 'text' },
  { key: 'token', label: '订阅 Token', input: 'text' },
  { key: 'remarks', label: '备注', input: 'text' },
]

interface Props {
  value: UserFilter[]
  onChange: (filters: UserFilter[]) => void
  onSearch: () => void
}

export default function UserFilterBar({ value, onChange, onSearch }: Props) {
  return (
    <FilterBar<UserFilterKey>
      fields={FIELDS}
      conditions={USER_FILTER_CONDITIONS}
      value={value}
      onChange={(f) => onChange(f as UserFilter[])}
      onSearch={onSearch}
    />
  )
}
