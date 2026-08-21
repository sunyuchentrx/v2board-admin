import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
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

interface FormValues {
  title: string
  content: string
  img_url: string | null
  tags: string[] | null
}

export default function NoticeList() {
  const qc = useQueryClient()
  const [form] = Form.useForm<FormValues>()
  const [editing, setEditing] = useState<AdminNotice | null | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  const { data: notices, isFetching } = useQuery({
    queryKey: ['notices'],
    queryFn: fetchNotices,
  })

  const reload = () => qc.invalidateQueries({ queryKey: ['notices'] })

  useEffect(() => {
    if (editing === undefined) return
    if (editing) {
      form.setFieldsValue({
        title: editing.title,
        content: editing.content,
        img_url: editing.img_url,
        tags: parseTags(editing.tags),
      })
    } else {
      form.resetFields()
    }
  }, [editing, form])

  async function handleOk() {
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
      setEditing(undefined)
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
          <Space>
            <span>公告管理</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              不分页，按 ID 倒序返回全部
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditing(null)}
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
          columns={[
            { title: 'ID', dataIndex: 'id', width: 64 },
            { title: '标题', dataIndex: 'title', width: 220, ellipsis: true },
            {
              title: '标签',
              dataIndex: 'tags',
              width: 180,
              render: (raw) => {
                const tags = parseTags(raw)
                return tags.length > 0 ? (
                  <Space size={4} wrap>
                    {tags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                )
              },
            },
            {
              title: '配图',
              dataIndex: 'img_url',
              width: 90,
              render: (v: string | null) =>
                v ? (
                  <a href={v} target="_blank" rel="noreferrer">
                    查看
                  </a>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
            {
              title: '更新时间',
              dataIndex: 'updated_at',
              width: 150,
              render: (v: number) => formatTime(v),
            },
            {
              title: '显示',
              dataIndex: 'show',
              width: 70,
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
              width: 130,
              render: (_, row) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setEditing(row)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      Modal.confirm({
                        title: `删除公告「${row.title}」？`,
                        okText: '确认删除',
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await dropNotice(row.id)
                          message.success('已删除')
                          reload()
                        },
                      })
                    }
                  />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={editing !== undefined}
        title={editing ? `编辑公告 #${editing.id}` : '新增公告'}
        onCancel={() => setEditing(undefined)}
        onOk={handleOk}
        confirmLoading={submitting}
        width={680}
        destroyOnClose
      >
        {/*
          编辑走 notice/save 带 id —— 路由里那个 notice/update 是死路由
          （NoticeController 没有 update 方法，实测 500）。
        */}
        <Form<FormValues> form={form} layout="vertical" preserve={false}>
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
            <Input.TextArea rows={8} placeholder="支持 HTML" />
          </Form.Item>
          <Form.Item
            name="img_url"
            label="配图 URL"
            rules={[{ type: 'url', message: '必须是合法 URL' }]}
            extra="留空表示无配图。后端校验是 nullable|url，随便填非 URL 会 422"
          >
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select
              mode="tags"
              placeholder="回车添加标签"
              tokenSeparators={[',', ' ']}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
