import { useState } from 'react'
import { Button, Form, Input, Modal, Typography, message } from 'antd'
import ProTable, { type ProColumns } from '@ant-design/pro-table'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dropServerGroup,
  fetchServerGroups,
  saveServerGroup,
  type ServerGroup,
} from '@/api/server'
import RowActions from '@/components/RowActions'
import './ServerPage.css'

/** 计数列：0 显示成次要色，其余等宽数字 */
function CountCell({ value }: { value: number | undefined }) {
  const n = value ?? 0
  return (
    <Typography.Text className="tabular-nums" type={n === 0 ? 'secondary' : undefined}>
      {n}
    </Typography.Text>
  )
}

export default function ServerGroupPanel() {
  const qc = useQueryClient()
  const [form] = Form.useForm<{ name: string }>()
  const [editing, setEditing] = useState<ServerGroup | null | undefined>(undefined)
  /**
   * 弹窗表单的初始值。不能在打开前调 form.setFieldsValue：弹窗 destroyOnHidden +
   * preserve={false}，表单挂载时 rc-field-form 会把上次卸载的字段重置成 initialValues，
   * 提前塞进去的值会被冲掉（开发模式 StrictMode 下连第一次打开都是空的）。
   */
  const [initial, setInitial] = useState<{ name?: string }>({})
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

  const columns: ProColumns<ServerGroup>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 72,
      render: (_, row) => <span className="tabular-nums">{row.id}</span>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (_, row) => <span className="server-page-strong">{row.name}</span>,
    },
    {
      title: '用户数',
      dataIndex: 'user_count',
      width: 110,
      align: 'right',
      render: (_, row) => <CountCell value={row.user_count} />,
    },
    {
      title: '节点数',
      dataIndex: 'server_count',
      width: 110,
      align: 'right',
      render: (_, row) => <CountCell value={row.server_count} />,
    },
    {
      title: '操作',
      key: 'option',
      valueType: 'option',
      width: 146,
      fixed: 'right',
      // 紧挨着右对齐的数字列，多留一点左边距
      className: 'server-page-op-col',
      render: (_, row) => (
        <RowActions
          actions={[
            {
              key: 'rename',
              label: '重命名',
              icon: <EditOutlined />,
              onClick: () => {
                setInitial({ name: row.name })
                setEditing(row)
              },
            },
            {
              key: 'delete',
              label: '删除',
              icon: <DeleteOutlined />,
              danger: true,
              iconOnly: true,
              onClick: () =>
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
                }),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <>
      <ProTable<ServerGroup>
        rowKey="id"
        loading={isFetching}
        dataSource={groups ?? []}
        columns={columns}
        search={false}
        pagination={false}
        scroll={{ x: 560 }}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        headerTitle={
          <span className="server-page-title">
            <span>全部权限组</span>
            <Typography.Text type="secondary" className="server-page-title-sub">
              套餐通过权限组决定能用哪些节点
            </Typography.Text>
          </span>
        }
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>,
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setInitial({})
              setEditing(null)
            }}
          >
            新增权限组
          </Button>,
        ]}
      />

      <Modal
        open={editing !== undefined}
        title={editing ? `重命名权限组 #${editing.id}` : '新增权限组'}
        onCancel={() => setEditing(undefined)}
        onOk={handleOk}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={submitting}
        width={520}
        destroyOnHidden
        maskClosable={false}
      >
        {/* 后端 GroupController::save 只读 name，没有其它可配项 */}
        <Form form={form} layout="vertical" preserve={false} initialValues={initial}>
          <Form.Item
            name="name"
            label="组名"
            rules={[{ required: true, message: '组名不能为空' }]}
            extra={
              editing
                ? '只改名字，已绑定这个组的套餐和节点不受影响'
                : '创建后在套餐和节点的「权限组」里选择它'
            }
          >
            <Input placeholder="例如：标准组" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
