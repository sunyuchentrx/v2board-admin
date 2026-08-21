import { useEffect, useState } from 'react'
import {
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dropKnowledge,
  fetchKnowledgeCategories,
  fetchKnowledgeDetail,
  fetchKnowledgeList,
  saveKnowledge,
  sortKnowledge,
  toggleKnowledgeShow,
  type AdminKnowledgeListItem,
} from '@/api/promo'
import { formatTime } from '@/lib/format'

/** language 列是 char(5)，常见取值与 resources/lang 下的文件名一致 */
const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文 (zh-CN)' },
  { value: 'en-US', label: 'English (en-US)' },
]

interface FormValues {
  category: string
  language: string
  title: string
  body: string
}

export default function KnowledgeList() {
  const qc = useQueryClient()
  const [form] = Form.useForm<FormValues>()
  /** undefined 关闭；null 新增；数字 = 编辑该 id */
  const [editingId, setEditingId] = useState<number | null | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  const { data: list, isFetching } = useQuery({
    queryKey: ['knowledge-list'],
    queryFn: fetchKnowledgeList,
  })
  const { data: categories } = useQuery({
    queryKey: ['knowledge-categories'],
    queryFn: fetchKnowledgeCategories,
  })

  // 列表接口只 select 了 title/id/updated_at/category/show，
  // 正文（body）和 language 必须单独取详情
  const { data: detail, isFetching: loadingDetail } = useQuery({
    queryKey: ['knowledge-detail', editingId],
    queryFn: () => fetchKnowledgeDetail(editingId as number),
    enabled: typeof editingId === 'number',
  })

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['knowledge-list'] })
    qc.invalidateQueries({ queryKey: ['knowledge-categories'] })
  }

  const sortMutation = useMutation({
    mutationFn: sortKnowledge,
    onSuccess: () => {
      message.success('顺序已保存')
      reload()
    },
  })

  useEffect(() => {
    if (editingId === undefined) return
    if (editingId === null) {
      form.resetFields()
      form.setFieldsValue({ language: 'zh-CN' } as FormValues)
    } else if (detail) {
      form.setFieldsValue({
        category: detail.category,
        language: detail.language,
        title: detail.title,
        body: detail.body,
      })
    }
  }, [editingId, detail, form])

  /** 后端 sort 接口要传全量顺序 */
  function move(index: number, delta: number) {
    if (!list) return
    const next = [...list]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const a = next[index]!
    const b = next[target]!
    next[index] = b
    next[target] = a
    sortMutation.mutate(next.map((k) => k.id))
  }

  async function handleOk() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      await saveKnowledge({
        ...(typeof editingId === 'number' ? { id: editingId } : {}),
        category: values.category,
        language: values.language,
        title: values.title,
        body: values.body,
      })
      message.success(typeof editingId === 'number' ? '已保存' : '已创建')
      reload()
      setEditingId(undefined)
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
            <span>知识库</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              不分页，按排序值升序
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
              onClick={() => setEditingId(null)}
            >
              新增文章
            </Button>
          </Space>
        }
      >
        <Table<AdminKnowledgeListItem>
          rowKey="id"
          loading={isFetching || sortMutation.isPending}
          dataSource={list ?? []}
          pagination={false}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 64 },
            { title: '标题', dataIndex: 'title', ellipsis: true },
            {
              title: '分类',
              dataIndex: 'category',
              width: 160,
              render: (v: string) => <Tag color="blue">{v}</Tag>,
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
                    await toggleKnowledgeShow(row.id)
                    message.success('已更新')
                    reload()
                  }}
                />
              ),
            },
            {
              title: '操作',
              width: 170,
              render: (_, row, index) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={index === (list?.length ?? 0) - 1}
                    onClick={() => move(index, 1)}
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setEditingId(row.id)}
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
                        title: `删除文章「${row.title}」？`,
                        okText: '确认删除',
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await dropKnowledge(row.id)
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
        open={editingId !== undefined}
        title={typeof editingId === 'number' ? `编辑文章 #${editingId}` : '新增文章'}
        onCancel={() => setEditingId(undefined)}
        onOk={handleOk}
        confirmLoading={submitting}
        width={780}
        destroyOnClose
      >
        <Spin spinning={loadingDetail}>
          <Form<FormValues> form={form} layout="vertical" preserve={false}>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item
                name="category"
                label="分类"
                rules={[{ required: true, message: '请输入或选择分类' }]}
                style={{ width: '60%' }}
              >
                {/*
                  用 AutoComplete 而不是 Select：分类是自由文本（后端只校验 required），
                  既要能从已有分类里选，也要能直接输入新分类。
                  Select 的 tags 模式值是数组，和这个字符串字段对不上。
                */}
                <AutoComplete
                  placeholder="选择已有分类，或直接输入新分类"
                  options={(categories ?? []).map((c) => ({ value: c }))}
                  filterOption={(input, option) =>
                    (option?.value ?? '')
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                />
              </Form.Item>
              <Form.Item
                name="language"
                label="语言"
                rules={[{ required: true, message: '请选择语言' }]}
                style={{ width: '40%' }}
              >
                <Select options={LANGUAGES} />
              </Form.Item>
            </Space.Compact>

            <Form.Item
              name="title"
              label="标题"
              rules={[{ required: true, message: '请输入标题' }]}
            >
              <Input placeholder="文章标题" />
            </Form.Item>
            <Form.Item
              name="body"
              label="正文"
              rules={[{ required: true, message: '请输入正文' }]}
              extra="支持 Markdown / HTML，具体渲染取决于前台主题"
            >
              <Input.TextArea rows={14} placeholder="文章内容" />
            </Form.Item>
          </Form>
        </Spin>
      </Modal>
    </>
  )
}
