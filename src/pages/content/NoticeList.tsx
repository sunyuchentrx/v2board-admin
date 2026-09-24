import { useRef, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Form,
  Grid,
  type FormInstance,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dropNotice,
  fetchNotices,
  saveNotice,
  toggleNoticeShow,
  type AdminNotice,
} from '@/api/promo'
import { formatTime } from '@/lib/format'
import RowActions from '@/components/RowActions'
import './ContentPages.css'

/** tags 在库里是 varchar，实际存 JSON 字符串 */
function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[]
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(String) : [raw]
    } catch {
      return [raw]
    }
  }
  return []
}

/**
 * 列表里的正文摘要：去掉 HTML 标签和常见 Markdown 记号只留文字（React 会转义，纯展示用）。
 * 先去标签再解实体，解出来的「<」不会被当成标签；行首记号要在合并空白之前去，否则认不出行首。
 */
function excerpt(content: string | null | undefined): string {
  if (!content) return ''
  return content
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [文字](链接)、![图](地址)
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '') // 分隔线 --- / ***
    .replace(/^\s*(?:[-+*]|\d+[.)]|#{1,6}|>)\s+/gm, '') // 列表、标题、引用
    .replace(/\*\*|__|~~|[*`]/g, '') // 粗体、删除线、行内代码
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/**
 * 手机上标题列的宽度：表格可视宽度（100vw − 页面左右留白 2×16 − 卡片内边距 2×16 − 边框 2）
 * 再减去固定在右侧的操作列 80，标题正好铺到固定列之前，不被它盖住，省略号也看得见。
 */
const COMPACT_TITLE_WIDTH = 'calc(100vw - 146px)'

interface FormValues {
  title: string
  content: string
  img_url: string | null
  tags: string[] | null
}

/** 空值占位「—」（有值的次要列用 .content-muted，对比度更高） */
const Muted = () => <Typography.Text type="secondary">—</Typography.Text>

export default function NoticeList() {
  const qc = useQueryClient()
  const formRef = useRef<FormInstance<FormValues>>(null)
  /** 弹窗对应的公告：null 新增；关闭动画结束（afterClose）才清空，动画期间标题和按钮不跳变 */
  const [editing, setEditing] = useState<AdminNotice | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** 手机宽度：操作列只留图标，标题列收窄到固定列之前，不被遮住 */
  const compact = Grid.useBreakpoint().sm === false

  const { data: notices, isFetching } = useQuery({
    queryKey: ['notices'],
    queryFn: fetchNotices,
  })

  const reload = () => qc.invalidateQueries({ queryKey: ['notices'] })

  function openEditor(row: AdminNotice | null) {
    setEditing(row)
    setOpen(true)
  }

  /*
   * 表单回填：每次打开弹窗都挂载一张新表单（destroyOnHidden + key），用它自己的 FormInstance（经 ref 取），
   * 值走 initialValues。
   * - 原写法（共享 useForm 实例 + useEffect 里 setFieldsValue）在开发环境的 StrictMode 下会被清空：
   *   新挂载的 Form 被模拟卸载再挂载一次，preserve={false} 的字段被重置回 initialValues（空），
   *   实测 dev 下编辑弹窗每次都是空的。
   * - 共享实例 + initialValues 也不行：字段卸载时会被重置成「上一张表单」的 initialValues 留在 store 里，
   *   下一张表单挂载时 store 优先 —— 实测生产构建里编辑第二行显示的是第一行、新增显示上一条的内容。
   * 每张表单一个实例，挂载时 store 为空，initialValues 在两种环境下都准确。
   */
  const initialValues: Partial<FormValues> | undefined = editing
    ? {
        title: editing.title,
        content: editing.content,
        img_url: editing.img_url,
        tags: parseTags(editing.tags),
      }
    : undefined

  async function handleOk() {
    const form = formRef.current
    if (!form) return
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      await saveNotice({
        ...(editing ? { id: editing.id } : {}),
        title: values.title,
        content: values.content,
        // 后端是 nullable|url —— 空字符串会 422，必须转 null
        img_url: values.img_url?.trim() ? values.img_url.trim() : null,
        tags: values.tags && values.tags.length > 0 ? values.tags : null,
      })
      message.success(editing ? '公告已保存' : '公告已发布')
      reload()
      setOpen(false)
    } catch {
      // 拦截器已提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Card
        title={
          <span className="content-card-title">
            <span>全部公告</span>
            <Typography.Text type="secondary" className="content-card-desc">
              {notices ? `共 ${notices.length} 条 · ` : ''}不分页，按 ID 倒序返回全部
            </Typography.Text>
          </span>
        }
        extra={
          <Space size={8}>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openEditor(null)}
            >
              新增公告
            </Button>
          </Space>
        }
      >
        <Table<AdminNotice>
          rowKey="id"
          loading={isFetching}
          dataSource={notices ?? []}
          pagination={false}
          // 桌面：定宽列合计 704 + 标题最少 216 = 920，1280 宽屏（表格可用 958）不出现横向滚动。
          // 手机：标题列宽 = 表格可视宽度 − 操作列，正好铺到固定列之前（见 COMPACT_TITLE_WIDTH）；
          // 这里的 x 按标题最窄 160 算，列宽合计更大时表格按合计撑开
          scroll={{ x: compact ? 760 : 920 }}
          columns={[
            {
              title: 'ID',
              dataIndex: 'id',
              width: 72,
              responsive: ['sm'],
              render: (v: number) => <span className="tabular-nums content-muted">{v}</span>,
            },
            {
              title: '标题',
              dataIndex: 'title',
              width: compact ? COMPACT_TITLE_WIDTH : undefined,
              ellipsis: true,
              render: (_, row) => {
                const sub = excerpt(row.content)
                return (
                  <div className="content-title-cell">
                    <span className="content-title-cell-main" title={row.title}>
                      {row.title}
                    </span>
                    {sub && <span className="content-title-cell-sub">{sub}</span>}
                  </div>
                )
              },
            },
            {
              title: '标签',
              dataIndex: 'tags',
              width: 184,
              render: (raw) => {
                const tags = parseTags(raw)
                return tags.length > 0 ? (
                  <div className="content-tags">
                    {tags.map((t) => (
                      <Tag key={t} bordered={false}>
                        {t}
                      </Tag>
                    ))}
                  </div>
                ) : (
                  <Muted />
                )
              },
            },
            {
              title: '配图',
              dataIndex: 'img_url',
              width: 96,
              render: (v: string | null) =>
                v ? (
                  <a
                    className="content-img-link"
                    href={v}
                    target="_blank"
                    rel="noreferrer"
                    title={v}
                  >
                    <LinkOutlined />
                    查看
                  </a>
                ) : (
                  <Muted />
                ),
            },
            {
              title: '更新时间',
              dataIndex: 'updated_at',
              width: 160,
              className: 'content-nowrap',
              render: (v: number) => (
                <span className="tabular-nums content-muted">{formatTime(v, '—')}</span>
              ),
            },
            {
              title: '显示',
              dataIndex: 'show',
              width: 80,
              align: 'center',
              render: (_, row) => (
                <Switch
                  size="small"
                  checked={row.show === 1}
                  onChange={async () => {
                    // 后端是取反
                    await toggleNoticeShow(row.id)
                    message.success('已更新')
                    reload()
                  }}
                />
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: compact ? 80 : 112,
              fixed: 'right',
              render: (_, row) => (
                <RowActions
                  actions={[
                    {
                      key: 'edit',
                      label: '编辑',
                      icon: <EditOutlined />,
                      iconOnly: compact,
                      onClick: () => openEditor(row),
                    },
                    {
                      key: 'delete',
                      label: '删除',
                      icon: <DeleteOutlined />,
                      danger: true,
                      iconOnly: true,
                      onClick: () =>
                        Modal.confirm({
                          title: '删除这条公告？',
                          content: `「${row.title}」删除后用户端立即不可见，且无法恢复。`,
                          okText: '确认删除',
                          okButtonProps: { danger: true },
                          onOk: async () => {
                            await dropNotice(row.id)
                            message.success('已删除')
                            reload()
                          },
                        }),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title={
          editing ? (
            <>
              编辑公告
              <Typography.Text type="secondary" className="content-modal-id">
                #{editing.id}
              </Typography.Text>
            </>
          ) : (
            '新增公告'
          )
        }
        onCancel={() => setOpen(false)}
        afterClose={() => setEditing(undefined)}
        onOk={handleOk}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={submitting}
        width={760}
        maskClosable={false}
        destroyOnHidden
        // 弹窗距顶约 100px、头尾约 140px，再留 40px：手机上底边（含圆角）不出视口，不会弹窗和页面双重滚动
        styles={{ body: { maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' } }}
      >
        {/*
          编辑走 notice/save 带 id —— 路由里那个 notice/update 是死路由
          （NoticeController 没有 update 方法，实测 500）。
        */}
        <Form<FormValues>
          key={editing?.id ?? 'new'}
          ref={formRef}
          layout="vertical"
          preserve={false}
          initialValues={initialValues}
        >
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input placeholder="公告标题" />
          </Form.Item>
          <Form.Item
            name="content"
            label="内容"
            rules={[{ required: true, message: '请输入内容' }]}
          >
            <Input.TextArea
              className="content-editor"
              autoSize={{ minRows: 10, maxRows: 20 }}
              placeholder="公告正文，支持 HTML"
            />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="img_url"
                label="配图 URL"
                // 后端校验是 nullable|url，随便填非 URL 会 422
                rules={[{ type: 'url', message: '必须是合法 URL' }]}
                tooltip="留空表示无配图；需填写以 http(s):// 开头的完整链接"
              >
                <Input
                  prefix={<PictureOutlined className="muted" />}
                  placeholder="https://..."
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="tags" label="标签" tooltip="回车、英文逗号或空格分隔">
                <Select
                  mode="tags"
                  style={{ width: '100%' }}
                  placeholder="回车添加标签"
                  tokenSeparators={[',', ' ']}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  )
}
