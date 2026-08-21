import { useRef, useState } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import { Button, Modal, Space, Tag, Tooltip, Typography, message } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import {
  dropGiftcard,
  GIFTCARD_TYPES,
  type AdminGiftcard,
} from '@/api/promo'
import { formatMoney, formatTime } from '@/lib/format'
import GiftcardCreateModal from './GiftcardCreateModal'

/** used_user_ids 是 JSON 字符串，取长度当兑换次数 */
function usedCount(raw: string | null): number {
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

/** 各类型 value 的显示口径，取自 GiftcardController::multiGenerate 的 CSV 逻辑 */
function formatValue(row: AdminGiftcard): string {
  const v = row.value ?? 0
  switch (row.type) {
    case 1:
      return formatMoney(v)
    case 2:
      return `${v} 天`
    case 3:
      return `${v} GB`
    case 4:
      return '重置流量'
    case 5:
      return `${v} 天（套餐 #${row.plan_id ?? '?'}）`
    default:
      return String(v)
  }
}

export default function GiftcardList() {
  const tableRef = useRef<ActionType>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const reload = () => tableRef.current?.reload()

  return (
    <>
      <ProTable<AdminGiftcard>
        actionRef={tableRef}
        rowKey="id"
        request={async (params, sort) =>
          proTableRequest<AdminGiftcard>(
            ADMIN_ENDPOINTS.giftcard.fetch,
            { current: params.current, pageSize: params.pageSize },
            sort as Record<string, 'ascend' | 'descend' | null>,
          ) as Promise<{ data: AdminGiftcard[]; total: number; success: boolean }>
        }
        columns={[
          { title: 'ID', dataIndex: 'id', width: 64, sorter: true },
          { title: '名称', dataIndex: 'name', width: 150, ellipsis: true },
          {
            title: '卡密',
            dataIndex: 'code',
            width: 210,
            render: (_, row) => (
              <Typography.Text copyable={{ text: row.code }} code style={{ fontSize: 12 }}>
                {row.code}
              </Typography.Text>
            ),
          },
          {
            title: '类型',
            dataIndex: 'type',
            width: 100,
            render: (_, row) => (
              <Tag>
                {GIFTCARD_TYPES[row.type as keyof typeof GIFTCARD_TYPES] ?? row.type}
              </Tag>
            ),
          },
          {
            title: '面值',
            width: 170,
            render: (_, row) => formatValue(row),
          },
          {
            title: '已兑换 / 上限',
            width: 120,
            render: (_, row) => {
              const used = usedCount(row.used_user_ids)
              const limit = row.limit_use
              return (
                <Tooltip title={limit ? `上限 ${limit} 次` : '不限次数'}>
                  {used} / {limit ?? '∞'}
                </Tooltip>
              )
            },
          },
          {
            title: '有效期',
            width: 200,
            render: (_, row) => (
              <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
                <span>{formatTime(row.started_at)}</span>
                <span>至 {formatTime(row.ended_at)}</span>
              </Space>
            ),
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            width: 150,
            render: (_, row) => formatTime(row.created_at),
          },
          {
            title: '操作',
            valueType: 'option',
            width: 80,
            fixed: 'right',
            render: (_, row) => [
              <Button
                key="del"
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  Modal.confirm({
                    title: `删除礼品卡「${row.name}」？`,
                    content:
                      '已兑换的记录不会回滚，只是这张卡今后不能再兑换。后端没有编辑礼品卡的接口，删了只能重新生成。',
                    okText: '确认删除',
                    okButtonProps: { danger: true },
                    onOk: async () => {
                      await dropGiftcard(row.id)
                      message.success('已删除')
                      reload()
                    },
                  })
                }
              />,
            ],
          },
        ]}
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 张卡`,
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        scroll={{ x: 1300 }}
        headerTitle={
          <Space>
            <span>礼品卡</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              本 fork 自定义功能，上游 v2board 没有
            </Typography.Text>
          </Space>
        }
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>,
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            生成礼品卡
          </Button>,
        ]}
      />

      <GiftcardCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={reload}
      />
    </>
  )
}
