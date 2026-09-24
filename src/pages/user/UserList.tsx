import { useCallback, useRef, useState } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import {
  Button,
  Dropdown,
  Grid,
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
  MoreOutlined,
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
import RowActions from '@/components/RowActions'
import { USER_COLUMNS_HIDDEN_BY_DEFAULT, buildUserColumns } from './columns'
import UserFilterBar from './UserFilterBar'
import UserEditModal from './UserEditModal'
import UserGenerateModal from './UserGenerateModal'
import BulkActionModal, { type BulkAction } from './BulkActionModal'
import './UserList.css'

/** 列显示设置（哪些列隐藏）记在本机，刷新后保留 */
const COLUMNS_STATE_KEY = 'v2board_admin_v2_user_columns'

/**
 * 默认显示的列（含操作列）宽度之和。表格用 table-layout: fixed，
 * 容器更宽时按比例拉伸；在列设置里打开更多列、总宽超过它时自动出现横向滚动。
 */
const TABLE_MIN_WIDTH = 1106

export default function UserList() {
  const tableRef = useRef<ActionType>(null)
  const [filters, setFilters] = useState<UserFilter[]>([])
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null)
  const [exporting, setExporting] = useState(false)

  const screens = Grid.useBreakpoint()
  // 手机上（< md）不固定左侧列，操作按钮只显示图标，否则固定列会占满整屏
  const wide = screens.md !== false
  const columns = buildUserColumns({ pin: wide })

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
            key: 'option',
            valueType: 'option',
            // 宽屏：文字按钮（不带图标，省下的宽度留给余额 / 佣金列）；手机：只显示图标
            width: wide ? 170 : 112,
            fixed: 'right',
            render: (_, row) => (
              <span className="user-page-actions">
                <RowActions
                  inline={2}
                  actions={[
                    {
                      key: 'edit',
                      label: '编辑',
                      icon: wide ? undefined : <EditOutlined />,
                      iconOnly: !wide,
                      onClick: () => setEditing(row),
                    },
                    {
                      key: 'reset',
                      label: '重置订阅',
                      icon: wide ? undefined : <SyncOutlined />,
                      iconOnly: !wide,
                      onClick: () => handleResetSecret(row),
                    },
                  ]}
                />
                {/* 删除单独放进「更多」：RowActions 只多出一个动作时会平铺，危险动作不该直接露在行里 */}
                <Dropdown
                  trigger={['click']}
                  placement="bottomRight"
                  menu={{
                    items: [
                      {
                        key: 'del',
                        icon: <DeleteOutlined />,
                        label: '删除用户',
                        danger: true,
                        onClick: () => handleDelete(row),
                      },
                    ],
                  }}
                >
                  <Button type="text" size="small" icon={<MoreOutlined />} aria-label="更多操作" />
                </Dropdown>
              </span>
            ),
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
        columnsState={{
          persistenceKey: COLUMNS_STATE_KEY,
          persistenceType: 'localStorage',
          defaultValue: Object.fromEntries(
            USER_COLUMNS_HIDDEN_BY_DEFAULT.map((key) => [key, { show: false }]),
          ),
        }}
        scroll={{ x: TABLE_MIN_WIDTH }}
        dateFormatter="string"
        headerTitle={
          <Space size={10} wrap>
            <span>全部用户</span>
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
