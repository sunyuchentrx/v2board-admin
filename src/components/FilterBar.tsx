import { useState } from 'react'
import { Button, Input, InputNumber, Select, Space, Tag, Typography } from 'antd'
import { ClearOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import './FilterBar.css'

/**
 * 通用过滤条。
 *
 * 后端多个列表接口共用同一套过滤模型：`filter[n][key|condition|value]` 三元组，
 * key 有白名单、condition 是 `> < = >= <= != 模糊` 之一（'模糊' 后端转成
 * LIKE %value%）。ProTable 自带的搜索表单表达不了「同一个键配不同比较符」，
 * 所以统一用这个组件。
 *
 * 每个页面只需给出自己的字段配置（键的白名单来自对应的 *Fetch.php）。
 */

export type FilterInputType = 'text' | 'number' | 'select'

export interface FilterFieldConfig<K extends string> {
  key: K
  label: string
  input: FilterInputType
  /** input === 'select' 时的选项 */
  options?: { value: string | number; label: string }[]
  /** 值的单位后缀，仅用于已添加条件的标签展示（例如 GB） */
  unit?: string
  /** 输入框占位符 */
  placeholder?: string
}

export interface FilterItem<K extends string> {
  key: K
  condition: string
  value: string | number
}

interface Props<K extends string> {
  fields: readonly FilterFieldConfig<K>[]
  conditions: readonly string[]
  value: FilterItem<K>[]
  onChange: (filters: FilterItem<K>[]) => void
  onSearch: () => void
  /** 右侧额外的控件（例如「只看有佣金的订单」开关） */
  extra?: React.ReactNode
}

export default function FilterBar<K extends string>({
  fields,
  conditions,
  value,
  onChange,
  onSearch,
  extra,
}: Props<K>) {
  const first = fields[0]
  const [draftKey, setDraftKey] = useState<K>(first!.key)
  const [draftCondition, setDraftCondition] = useState<string>(
    first!.input === 'text' ? '模糊' : '=',
  )
  const [draftValue, setDraftValue] = useState<string>('')

  const field = fields.find((f) => f.key === draftKey) ?? first!

  function addFilter() {
    if (draftValue === '') return
    onChange([
      ...value,
      { key: draftKey, condition: draftCondition, value: draftValue },
    ])
    setDraftValue('')
  }

  function renderValueInput() {
    if (field.input === 'select') {
      return (
        <Select
          className="filter-bar-value"
          value={draftValue === '' ? undefined : draftValue}
          onChange={setDraftValue}
          placeholder={field.placeholder ?? '选择'}
          options={(field.options ?? []).map((o) => ({
            value: String(o.value),
            label: o.label,
          }))}
        />
      )
    }
    if (field.input === 'number') {
      return (
        <InputNumber
          className="filter-bar-value"
          value={draftValue === '' ? null : Number(draftValue)}
          onChange={(v) => setDraftValue(v === null ? '' : String(v))}
          placeholder={field.placeholder ?? '数值'}
          onPressEnter={addFilter}
        />
      )
    }
    return (
      <Input
        className="filter-bar-value"
        value={draftValue}
        onChange={(e) => setDraftValue(e.target.value)}
        placeholder={field.placeholder ?? '输入值后回车添加'}
        onPressEnter={addFilter}
        allowClear
      />
    )
  }

  return (
    <div className="filter-bar">
      <div className="filter-bar-row">
        <Space.Compact className="filter-bar-builder">
          <Select<K>
            className="filter-bar-key"
            value={draftKey}
            onChange={(k) => {
              setDraftKey(k)
              setDraftValue('')
              const next = fields.find((f) => f.key === k)
              setDraftCondition(next?.input === 'text' ? '模糊' : '=')
            }}
            options={fields.map((f) => ({ value: f.key, label: f.label }))}
            popupMatchSelectWidth={false}
          />
          <Select
            className="filter-bar-cond"
            value={draftCondition}
            onChange={setDraftCondition}
            options={conditions.map((c) => ({ value: c, label: c }))}
            popupMatchSelectWidth={false}
          />
          {renderValueInput()}
          <Button icon={<PlusOutlined />} onClick={addFilter} disabled={draftValue === ''}>
            添加
          </Button>
        </Space.Compact>

        <div className="filter-bar-actions">
          {extra}
          {value.length > 0 && (
            <Button
              icon={<ClearOutlined />}
              onClick={() => {
                onChange([])
                onSearch()
              }}
            >
              清空
            </Button>
          )}
          <Button type="primary" icon={<SearchOutlined />} onClick={onSearch}>
            查询
          </Button>
        </div>
      </div>

      {value.length > 0 && (
        <div className="filter-bar-tags">
          <span className="filter-bar-tags-label">筛选条件</span>
          {value.map((f, i) => {
            const meta = fields.find((x) => x.key === f.key)
            const shown =
              meta?.input === 'select'
                ? (meta.options?.find((o) => String(o.value) === String(f.value))
                    ?.label ?? String(f.value))
                : String(f.value)
            return (
              <Tag
                key={`${f.key}-${f.condition}-${f.value}-${i}`}
                closable
                bordered={false}
                color="processing"
                className="filter-bar-tag"
                onClose={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <span className="filter-bar-tag-key">{meta?.label ?? f.key}</span>
                <span className="filter-bar-tag-cond">{f.condition}</span>
                <span className="filter-bar-tag-val">
                  {shown}
                  {meta?.unit ? ` ${meta.unit}` : ''}
                </span>
              </Tag>
            )
          })}
          <Typography.Text type="secondary" className="filter-bar-hint">
            修改条件后点击「查询」生效
          </Typography.Text>
        </div>
      )}
    </div>
  )
}
