import { useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dropServerGroup,
  fetchServerGroups,
  saveServerGroup,
  type ServerGroup,
} from '@/api/server'

export default function ServerGroupPanel() {
  const qc = useQueryClient()
  const [form] = Form.useForm<{ name: string }>()
  const [editing, setEditing] = useState<ServerGroup | null | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  const { data: groups, isFetching } = useQuery({
    queryKey: ['server-groups'],
    queryFn: fetchServerGroups,
  })

  const reload = () => qc.invalidateQueries({ queryKey: ['server-groups'] })

  async function handleOk() {
    let values: { name: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      await saveServerGroup({
        ...(editing ? { id: editing.id } : {}),
        name: values.name,
      })
      message.success(editing ? '已保存' : '已创建')
      reload()
      setEditing(undefined)
      form.resetFields()
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
            <span>权限组</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              套餐通过权限组决定能用哪些节点
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
              onClick={() => {
                form.resetFields()
                setEditing(null)
              }}
            >
              新增权限组
            </Button>
          </Space>
        }
      >
        <Table<ServerGroup>
          rowKey="id"
          loading={isFetching}
          dataSource={groups ?? []}
          pagination={false}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 80 },
            { title: '名称', dataIndex: 'name' },
            {
              title: '用户数',
              dataIndex: 'user_count',
              width: 110,
              render: (v: number | undefined) => <Tag color="blue">{v ?? 0}</Tag>,
            },
            {
              title: '节点数',
              dataIndex: 'server_count',
              width: 110,
              render: (v: number | undefined) => <Tag color="geekblue">{v ?? 0}</Tag>,
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
                    onClick={() => {
                      form.setFieldsValue({ name: row.name })
                      setEditing(row)
                    }}
                  >
                    重命名
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      Modal.confirm({
                        title: `删除权限组「${row.name}」？`,
                        content:
                          '若有任何节点仍绑定这个组，后端会拒绝删除。注意：绑定了该组的用户不会被自动迁移。',
                        okText: '确认删除',
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await dropServerGroup(row.id)
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
        title={editing ? `重命名权限组 #${editing.id}` : '新增权限组'}
        onCancel={() => setEditing(undefined)}
        onOk={handleOk}
        confirmLoading={submitting}
        destroyOnClose
      >
        {/* 后端 GroupController::save 只读 name，没有其它可配项 */}
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="组名"
            rules={[{ required: true, message: '组名不能为空' }]}
          >
            <Input placeholder="例如：标准组" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
