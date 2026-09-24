import { Form, Switch, type FormItemProps } from 'antd'
import type { ReactNode } from 'react'
import './SettingSwitch.css'

/**
 * 表单里的开关项：标题 + 说明在左、开关在右的一整行卡片。
 *
 * 用它替代「Form.Item label + Switch」塞进栅格列的写法 —— 后者的开关只有 22px 高，
 * 和同一行 34px 的输入框放在一起时上下对不齐，带 extra 说明的列还会把整行撑高。
 *
 * 用法：
 *   <SettingSwitch name="banned" title="封禁" description="封禁会踢掉全部会话" />
 * 在 Row/Col 里使用时同样对齐（整行卡片等高）。
 */
interface Props extends Omit<FormItemProps, 'label' | 'extra' | 'children' | 'valuePropName'> {
  title: ReactNode
  description?: ReactNode
  disabled?: boolean
  /** 右侧额外内容（例如标签），放在开关左边 */
  addon?: ReactNode
  onChange?: (checked: boolean) => void
}

function SwitchRow({
  title,
  description,
  addon,
  checked,
  onChange,
  disabled,
  id,
}: {
  title: ReactNode
  description?: ReactNode
  addon?: ReactNode
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
}) {
  return (
    <label className={`setting-switch${disabled ? ' is-disabled' : ''}`} htmlFor={id}>
      <span className="setting-switch-text">
        <span className="setting-switch-title">{title}</span>
        {description && <span className="setting-switch-desc">{description}</span>}
      </span>
      <span className="setting-switch-control">
        {addon}
        <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
      </span>
    </label>
  )
}

export default function SettingSwitch({
  title,
  description,
  disabled,
  addon,
  onChange,
  className,
  ...itemProps
}: Props) {
  return (
    <Form.Item
      {...itemProps}
      valuePropName="checked"
      className={`setting-switch-item${className ? ` ${className}` : ''}`}
      getValueFromEvent={(checked: boolean) => {
        onChange?.(checked)
        return checked
      }}
    >
      <SwitchRow title={title} description={description} disabled={disabled} addon={addon} />
    </Form.Item>
  )
}
