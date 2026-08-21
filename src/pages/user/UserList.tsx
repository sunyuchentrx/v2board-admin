import { useCallback, useRef, useState } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import {
  Button,
  Dropdown,
  Modal,
  Space,
  Typography,
  message,
} from 'antd'
import {
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  MailOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import {
  deleteUser,
  dumpUsersCSV,
  resetUserSecret,
  type AdminUser,
  type UserFilter,
} from '@/api/user'
import { downloadText } from '@/lib/download'
import { buildUserColumns } from './columns'
import UserFilterBar from './UserFilterBar'
import UserEditModal from './UserEditModal'
import UserGenerateModal from './UserGenerateModal'
import BulkActionModal, { type BulkAction } from './BulkActionModal'

export default function UserList() {
  const tableRef = useRef<ActionType>(null)
  const [filters, setFilters] = useState<UserFilter[]>([])
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null)
  const [exporting, setExporting] = useState(false)

  const columns = buildUserColumns()

  const reload = useCallback(() => {
    tableRef.current?.reload()
  }, [])

  async function handleResetSecret(row: AdminUser) {
    Modal.confirm({
      title: `重置 ${row.email} 的订阅信息？`,
      icon: <ExclamationCircleFilled />,
      content:
        '会重新生成该用户的订阅 token 和 UUID，他当前的订阅链接会立即失效，需要重新导入客户端。',
      okText: '确认重置',
      okButtonProps: { danger: true },
      onOk: async () => {
        await resetUserSecret(row.id)
        message.success('订阅信息已重置')
        reload()
      },
    })
  }

  async function handleDelete(row: AdminUser) {
    Modal.confirm({
      title: `删除用户 ${row.email}？`,
      icon: <ExclamationCircleFilled />,
      content:
        '不可恢复。会一并删除该用户的订单、邀请码、工单及工单消息，并解除其他用户对他的邀请关系。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteUser(row.id)
        message.success('用户已删除')
        reload()
      },
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      // 注意：导出同样是按**当前筛选条件**，不是按勾选行
      const csv = await dumpUsersCSV({ filter: filters })
      // 行数从 CSV 内容本身算，不用表格的 total —— 后者是上一次列表请求的结果，
      // 用户改了条件没点查询时会对不上（实测过：CSV 有 28 行却提示"已导出 0 个"）。
      const rows = csv
        .split('\n')
        .filter((line) => line.trim() !== '').length - 1 // 减掉表头
      const count = Math.max(0, rows)
      downloadText(csv, `v2board-users-${count}.csv`)
      message.success(`已导出 ${count} 个用户`)
    } catch {
      // 拦截器已提示
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <UserFilterBar value={filters} onChange={setFilters} onSearch={reload} />

      <ProTable<AdminUser>
        actionRef={tableRef}
        rowKey="id"
        columns={[
          ...columns,
          {
            title: '操作',
            valueType: 'option',
            width: 168,
            fixed: 'right',
            render: (_, row) => [
              <Button
                key="edit"
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => setEditing(row)}
              >
                编辑
              </Button>,
              <Button
                key="reset"
                type="link"
                size="small"
                icon={<SyncOutlined />}
                onClick={() => handleResetSecret(row)}
              >
                重置订阅
              </Button>,
              <Button
                key="del"
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(row)}
              />,
            ],
          },
        ]}
        request={async (params, sort) => {
          const { current, pageSize } = params
          const result = await proTableRequest<AdminUser>(
            ADMIN_ENDPOINTS.user.fetch,
            {
              current,
              pageSize,
              // 后端要的是 filter[n][key|condition|value]，
              // 由 axios 的 Laravel 风格序列化器展开（见 api/serialize.ts）
              filter: filters.length > 0 ? filters : undefined,
            },
            sort as Record<string, 'ascend' | 'descend' | null>,
          )
          return result as { data: AdminUser[]; total: number; success: boolean }
        }}
        // 后端 pageSize < 10 会被强制改成 10，所以不提供更小的选项
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 个用户`,
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        scroll={{ x: 1700 }}
        dateFormatter="string"
        headerTitle={
          <Space>
            <span>用户管理</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              批量操作作用于筛选结果，不是勾选行
            </Typography.Text>
          </Space>
        }
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>,
          <Button
            key="export"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={handleExport}
          >
            导出 CSV
          </Button>,
          <Dropdown
            key="bulk"
            // 必须显式指定 click：antd Dropdown 默认 hover 触发，
            // 鼠标扫过就展开一个含「批量删除」的菜单太容易误触。
            trigger={['click']}
            menu={{
              // 菜单里刻意不显示数量：那个数字只能取自上一次列表请求，
              // 用户改了筛选条件没点查询时就是错的。准确数量由弹窗打开时
              // 按当前条件重新查询后给出。
              items: [
                {
                  key: 'sendMail',
                  icon: <MailOutlined />,
                  label: '群发邮件（按筛选结果）',
                },
                {
                  key: 'ban',
                  icon: <StopOutlined />,
                  label: '批量封禁（按筛选结果）',
                  danger: true,
                },
                { type: 'divider' },
                {
                  key: 'allDel',
                  icon: <DeleteOutlined />,
                  label: '批量删除（按筛选结果）',
                  danger: true,
                },
              ],
              onClick: ({ key }) => setBulkAction(key as BulkAction),
            }}
          >
            <Button>
              <Space size={4}>
                批量操作
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>,
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setGenerateOpen(true)}
          >
            生成用户
          </Button>,
        ]}
      />

      <UserEditModal
        open={editing !== null}
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />

      <UserGenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onDone={reload}
      />

      <BulkActionModal
        action={bulkAction}
        filters={filters}
        onClose={() => setBulkAction(null)}
        onDone={reload}
      />
    </>
  )
}
