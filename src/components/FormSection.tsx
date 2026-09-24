import type { ReactNode } from 'react'
import './FormSection.css'

/**
 * 表单里的分组小节：标题 + 可选说明，下面是这一组字段。
 *
 * 替代 `<Divider orientation="left" plain>` 当小标题的写法 —— Divider 的线和文字
 * 在不同宽度下对不齐，也放不下说明文字。
 */
export default function FormSection({
  title,
  description,
  extra,
  children,
  first,
}: {
  title: ReactNode
  description?: ReactNode
  /** 标题行右侧的内容（例如一个开关或按钮） */
  extra?: ReactNode
  children: ReactNode
  /** 第一个小节不需要顶部分隔线 */
  first?: boolean
}) {
  return (
    <section className={`form-section${first ? ' is-first' : ''}`}>
      <header className="form-section-head">
        <div className="form-section-titles">
          <h4 className="form-section-title">{title}</h4>
          {description && <p className="form-section-desc">{description}</p>}
        </div>
        {extra && <div className="form-section-extra">{extra}</div>}
      </header>
      {children}
    </section>
  )
}
