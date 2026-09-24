import type { ReactNode } from 'react'
import { Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import './RowActions.css'

/**
 * 表格「操作」列的统一写法：前 `inline` 个动作直接显示成文字按钮，其余收进「更多」菜单。
 *
 * 原来各页面在操作列里平铺 3~5 个 link 按钮，列宽一不够就换行/被固定列遮住，
 * 行高也跟着参差不齐。统一成这个组件后，操作列宽度可预期（inline=2 时约 150px）。
 */
export interface RowAction {
  key: string
  label: ReactNode
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  /** 只显示图标（label 作为 tooltip），用于很短的操作列 */
  iconOnly?: boolean
  /** 置于菜单中时与上一项之间加分隔线 */
  divider?: boolean
}

export default function RowActions({
  actions,
  inline = 2,
}: {
  actions: (RowAction | false | null | undefined)[]
  /** 直接显示的按钮数，其余进「更多」 */
  inline?: number
}) {
  const list = actions.filter(Boolean) as RowAction[]
  // 只多出一个时直接平铺，没必要为了一个动作开菜单
  const shown = list.length <= inline + 1 ? list : list.slice(0, inline)
  const rest = list.length <= inline + 1 ? [] : list.slice(inline)

  const menuItems: MenuProps['items'] = []
  rest.forEach((a, i) => {
    if (a.divider && i > 0) menuItems.push({ type: 'divider' })
    menuItems.push({
      key: a.key,
      icon: a.icon,
      label: a.label,
      danger: a.danger,
      disabled: a.disabled,
      onClick: a.onClick,
    })
  })

  return (
    <span className="row-actions">
      {shown.map((a) =>
        a.iconOnly ? (
          <Tooltip key={a.key} title={a.label}>
            <Button
              type="text"
              size="small"
              danger={a.danger}
              disabled={a.disabled}
              icon={a.icon}
              onClick={a.onClick}
              aria-label={typeof a.label === 'string' ? a.label : undefined}
            />
          </Tooltip>
        ) : (
          <Button
            key={a.key}
            type="link"
            size="small"
            danger={a.danger}
            disabled={a.disabled}
            icon={a.icon}
            onClick={a.onClick}
          >
            {a.label}
          </Button>
        ),
      )}
      {rest.length > 0 && (
        <Dropdown trigger={['click']} menu={{ items: menuItems }} placement="bottomRight">
          <Button type="text" size="small" icon={<MoreOutlined />} aria-label="更多操作" />
        </Dropdown>
      )}
    </span>
  )
}
