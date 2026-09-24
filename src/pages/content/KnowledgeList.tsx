import { useEffect, useRef, useState } from 'react'
import {
  AutoComplete,
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
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
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
  type AdminKnowledge,
  type AdminKnowledgeListItem,
} from '@/api/promo'
import { formatTime } from '@/lib/format'
import RowActions, { type RowAction } from '@/components/RowActions'
import './ContentPages.css'

/** language 列是 char(5)，常见取值与 resources/lang 下的文件名一致 */
const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文 (zh-CN)' },
  { value: 'en-US', label: 'English (en-US)' },
]

/**
 * 手机上标题列的宽度：表格可视宽度（100vw − 页面左右留白 2×16 − 卡片内边距 2×16 − 边框 2）
 * 再减去固定在右侧的操作列 80，标题正好铺到固定列之前，不被它盖住，省略号也看得见。
 */
const COMPACT_TITLE_WIDTH = 'calc(100vw - 146px)'

interface FormValues {
  category: string
  language: string
  title: string
  body: string
}

function toFormValues(detail: AdminKnowledge): FormValues {
  return {
    category: detail.category,
    language: detail.language,
    title: detail.title,
    body: detail.body,
  }
}

/** 空值占位「—」（有值的次要列用 .content-muted，对比度更高） */
const Muted = () => <Typography.Text type="secondary">—</Typography.Text>

export default function KnowledgeList() {
  const qc = useQueryClient()
  const formRef = useRef<FormInstance<FormValues>>(null)
  /**
   * undefined 关闭；null 新增；数字 = 编辑该 id。
   * 关闭时先收 open，等关闭动画结束（afterClose）再清空，动画期间弹窗内容不跳成骨架屏。
   */
  const [editingId, setEditingId] = useState<number | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** 手机宽度：排序收进「更多」菜单、操作列只留图标，标题列不被固定列盖住 */
  const compact = Grid.useBreakpoint().sm === false

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

  const isEdit = typeof editingId === 'number'

  /*
   * 表单回填：每次打开弹窗都挂载一张新表单（destroyOnHidden + key），用它自己的 FormInstance（经 ref 取），
   * 挂载时的值走 initialValues —— 新增时带上默认语言，编辑且详情已在缓存里时直接带上详情。
   * - 原写法（共享 useForm 实例 + useEffect 里 resetFields / setFieldsValue）在开发环境的 StrictMode 下
   *   会被清空：新挂载的 Form 被模拟卸载再挂载一次，preserve={false} 的字段被重置回 initialValues（空），
   *   实测 dev 下新增时「语言」默认值丢失、详情命中缓存时编辑表单是空的。
   * - 共享实例 + initialValues 也不行：字段卸载时会被重置成「上一张表单」的 initialValues 留在 store 里，
   *   下一张表单挂载时 store 优先，生产构建里会带出上一篇的内容。
   * 每张表单一个实例，挂载时 store 为空，initialValues 在两种环境下都准确。
   */
  const initialValues: Partial<FormValues> | undefined =
    isEdit && detail ? toFormValues(detail) : editingId === null ? { language: 'zh-CN' } : undefined

  // 详情在表单挂载之后才取回（首次打开、或缓存过期后的重取）时，写回已挂载的表单，
  // 与原先 useEffect 回填的行为一致；表单还没挂载时 ref 为空，由上面的 initialValues 带上。
  // 内容没变时 react-query 保持同一个对象引用，不会重复写入。
  useEffect(() => {
    if (typeof editingId === 'number' && detail) formRef.current?.setFieldsValue(toFormValues(detail))
  }, [editingId, detail])

  function openEditor(id: number | null) {
    setEditingId(id)
    setOpen(true)
  }

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
      await saveKnowledge({
        ...(typeof editingId === 'number' ? { id: editingId } : {}),
        category: values.category,
        language: values.language,
        title: values.title,
        body: values.body,
      })
      message.success(typeof editingId === 'number' ? '已保存' : '已创建')
      reload()
      setOpen(false)
    } catch {
      // 拦截器已提示
    } finally {
      setSubmitting(false)
    }
  }

  const lastIndex = (list?.length ?? 0) - 1

  function rowActions(row: AdminKnowledgeListItem, index: number): RowAction[] {
    const edit: RowAction = {
      key: 'edit',
      label: '编辑',
      icon: <EditOutlined />,
      iconOnly: compact,
      onClick: () => openEditor(row.id),
    }
    const remove: RowAction = {
      key: 'delete',
      label: '删除',
      icon: <DeleteOutlined />,
      danger: true,
      iconOnly: true,
      divider: true,
      onClick: () =>
        Modal.confirm({
          title: '删除这篇文章？',
          content: `「${row.title}」删除后用户端立即不可见，且无法恢复。`,
          okText: '确认删除',
          okButtonProps: { danger: true },
          onOk: async () => {
            await dropKnowledge(row.id)
            message.success('已删除')
            reload()
          },
        }),
    }
    if (!compact) return [edit, remove]
    // 手机上排序列放不下，上移/下移收进「更多」菜单（与桌面排序列调用同一个 move，禁用条件也相同）
    return [
      edit,
      {
        key: 'up',
        label: '上移',
        icon: <ArrowUpOutlined />,
        disabled: index === 0,
        onClick: () => move(index, -1),
      },
      {
        key: 'down',
        label: '下移',
        icon: <ArrowDownOutlined />,
        disabled: index === lastIndex,
        onClick: () => move(index, 1),
      },
      remove,
    ]
  }

  return (
    <>
      <Card
        title={
          <span className="content-card-title">
            <span>全部文章</span>
            <Typography.Text type="secondary" className="content-card-desc">
              {list ? `共 ${list.length} 篇 · ` : ''}不分页，按排序值升序
            </Typography.Text>
          </span>
        }
        extra={
          <Space size={8}>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>
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
          // 桌面：定宽列合计 672 + 标题最少 188 = 860。
          // 手机：排序列和 ID 列隐藏，标题列宽 = 表格可视宽度 − 操作列，正好铺到固定列之前
          // （见 COMPACT_TITLE_WIDTH）；这里的 x 按标题最窄 160 算，列宽合计更大时表格按合计撑开
          scroll={{ x: compact ? 640 : 860 }}
          columns={[
            {
              title: '排序',
              key: 'sort',
              width: 88,
              responsive: ['sm'],
              render: (_, _row, index) => (
                <span className="content-sort">
                  <Tooltip title="上移">
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowUpOutlined />}
                      aria-label="上移"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    />
                  </Tooltip>
                  <span className="content-sort-sep" />
                  <Tooltip title="下移">
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowDownOutlined />}
                      aria-label="下移"
                      disabled={index === lastIndex}
                      onClick={() => move(index, 1)}
                    />
                  </Tooltip>
                </span>
              ),
            },
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
              render: (v: string) => (
                <span className="content-title-cell-main" title={v}>
                  {v}
                </span>
              ),
            },
            {
              title: '分类',
              dataIndex: 'category',
              width: 160,
              render: (v: string) =>
                v ? (
                  // 分类只是归类、不带状态含义：统一一种颜色（blue 在浅色 / 暗色下文字对比度都 ≥ 4.5:1）
                  <Tag bordered={false} color="blue">
                    {v}
                  </Tag>
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
                    await toggleKnowledgeShow(row.id)
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
              render: (_, row, index) => (
                <RowActions actions={rowActions(row, index)} inline={compact ? 1 : 2} />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title={
          isEdit ? (
            <>
              编辑文章
              <Typography.Text type="secondary" className="content-modal-id">
                #{editingId}
              </Typography.Text>
            </>
          ) : (
            '新增文章'
          )
        }
        onCancel={() => setOpen(false)}
        afterClose={() => setEditingId(undefined)}
        onOk={handleOk}
        okText={isEdit ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={submitting}
        width={960}
        maskClosable={false}
        destroyOnHidden
        // 弹窗距顶约 100px、头尾约 140px，再留 40px：手机上底边（含圆角）不出视口，不会弹窗和页面双重滚动
        styles={{ body: { maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' } }}
      >
        <Spin spinning={loadingDetail}>
          <Form<FormValues>
            key={editingId ?? 'new'}
            ref={formRef}
            layout="vertical"
            preserve={false}
            initialValues={initialValues}
          >
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="title"
                  label="标题"
                  rules={[{ required: true, message: '请输入标题' }]}
                >
                  <Input placeholder="文章标题" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={14} md={7}>
                <Form.Item
                  name="category"
                  label="分类"
                  tooltip="可从已有分类中选择，也可以直接输入新分类"
                  rules={[{ required: true, message: '请输入或选择分类' }]}
                >
                  {/*
                    用 AutoComplete 而不是 Select：分类是自由文本（后端只校验 required），
                    既要能从已有分类里选，也要能直接输入新分类。
                    Select 的 tags 模式值是数组，和这个字符串字段对不上。
                  */}
                  <AutoComplete
                    style={{ width: '100%' }}
                    placeholder="选择或输入分类"
                    options={(categories ?? []).map((c) => ({ value: c }))}
                    filterOption={(input, option) =>
                      (option?.value ?? '')
                        .toLowerCase()
                        .includes(input.toLowerCase())
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={10} md={5}>
                <Form.Item
                  name="language"
                  label="语言"
                  rules={[{ required: true, message: '请选择语言' }]}
                >
                  <Select style={{ width: '100%' }} options={LANGUAGES} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="body"
              label="正文"
              rules={[{ required: true, message: '请输入正文' }]}
              extra="支持 Markdown / HTML，具体渲染取决于前台主题"
            >
              <Input.TextArea
                className="content-editor"
                autoSize={{ minRows: 14, maxRows: 24 }}
                placeholder="文章内容"
              />
            </Form.Item>
          </Form>
        </Spin>
      </Modal>
    </>
  )
}
