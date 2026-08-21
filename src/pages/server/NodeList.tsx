import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Dropdown,
  Modal,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  copyNode,
  dropNode,
  fetchNodes,
  SERVER_PROTOCOLS,
  updateNodeShow,
  type ServerNode,
  type ServerProtocol,
} from '@/api/server'
import { formatTime } from '@/lib/format'
import { PROTOCOL_LABELS } from './protocolSchema'
import NodeEditModal from './NodeEditModal'
import ServerGroupPanel from './ServerGroupPanel'
import ServerRoutePanel from './ServerRoutePanel'

function NodeTable() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<{
    protocol: ServerProtocol
    node: ServerNode | null
  } | null>(null)

  const { data: nodes, isFetching } = useQuery({
    queryKey: ['server-nodes'],
    queryFn: fetchNodes,
  })

  const reload = () => qc.invalidateQueries({ queryKey: ['server-nodes'] })

  /** 各协议的节点数，用于标签页上的计数 */
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of nodes ?? []) {
      map.set(n.type, (map.get(n.type) ?? 0) + 1)
    }
    return map
  }, [nodes])

  return (
    <>
      <Card
        title={
          <Space>
            <span>节点管理</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              8 种协议合并展示，按排序值升序
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: SERVER_PROTOCOLS.map((p) => ({
                  key: p,
                  label: `${PROTOCOL_LABELS[p]}${
                    counts.get(p) ? `（现有 ${counts.get(p)}）` : ''
                  }`,
                })),
                onClick: ({ key }) =>
                  setEditing({ protocol: key as ServerProtocol, node: null }),
              }}
            >
              <Button type="primary" icon={<PlusOutlined />}>
                <Space size={4}>
                  新增节点
                  <DownOutlined />
                </Space>
              </Button>
            </Dropdown>
          </Space>
        }
      >
        <Table<ServerNode>
          rowKey={(row) => `${row.type}-${row.id}`}
          loading={isFetching}
          dataSource={nodes ?? []}
          pagination={false}
          scroll={{ x: 1300 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 64 },
            {
              title: '协议',
              dataIndex: 'type',
              width: 130,
              render: (v: ServerProtocol) => (
                <Tag color="geekblue">{PROTOCOL_LABELS[v] ?? v}</Tag>
              ),
              filters: SERVER_PROTOCOLS.map((p) => ({
                text: PROTOCOL_LABELS[p],
                value: p,
              })),
              onFilter: (value, row) => row.type === value,
            },
            {
              title: '名称',
              dataIndex: 'name',
              width: 200,
              ellipsis: true,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <span>{row.name}</span>
                  {row.parent_id ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      子节点（父 #{row.parent_id}）
                    </Typography.Text>
                  ) : null}
                </Space>
              ),
            },
            {
              title: '地址',
              width: 210,
              ellipsis: true,
              render: (_, row) => (
                <Typography.Text copyable={{ text: `${row.host}:${row.port}` }}>
                  {row.host}:{row.port}
                </Typography.Text>
              ),
            },
            {
              title: '连接端口',
              dataIndex: 'server_port',
              width: 90,
            },
            {
              title: '倍率',
              dataIndex: 'rate',
              width: 70,
              render: (v: string) => `${v}x`,
            },
            {
              title: '权限组',
              dataIndex: 'group_id',
              width: 120,
              render: (v: number[] | null) =>
                v && v.length > 0 ? (
                  <Space size={2} wrap>
                    {v.map((g) => (
                      <Tag key={g}>#{g}</Tag>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="danger">未分配</Typography.Text>
                ),
            },
            {
              title: '在线',
              dataIndex: 'online',
              width: 80,
              render: (v: number | undefined, row) => (
                <Tooltip
                  title={
                    row.last_push_at
                      ? `最后上报 ${formatTime(row.last_push_at)}`
                      : '从未上报数据'
                  }
                >
                  <Badge
                    status={row.last_push_at ? 'success' : 'default'}
                    text={v ?? 0}
                  />
                </Tooltip>
              ),
            },
            {
              title: '显示',
              dataIndex: 'show',
              width: 70,
              render: (_, row) => (
                <Switch
                  size="small"
                  checked={row.show === 1}
                  onChange={async (checked) => {
                    // 节点的 update 是**设值**（和 coupon/notice 的取反不同）
                    await updateNodeShow(row.type, row.id, checked ? 1 : 0)
                    message.success(checked ? '已显示' : '已隐藏')
                    reload()
                  }}
                />
              ),
            },
            {
              title: '操作',
              width: 170,
              fixed: 'right',
              render: (_, row) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setEditing({ protocol: row.type, node: row })}
                  >
                    编辑
                  </Button>
                  <Tooltip title="复制一份（副本默认隐藏）">
                    <Button
                      type="link"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={async () => {
                        await copyNode(row.type, row.id)
                        message.success('已复制，副本默认为隐藏状态')
                        reload()
                      }}
                    />
                  </Tooltip>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      Modal.confirm({
                        title: `删除节点「${row.name}」？`,
                        content:
                          '删除后该节点的历史流量统计仍会保留，但节点端会立即失效。若有子节点指向它，子节点会变成孤立节点。',
                        okText: '确认删除',
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await dropNode(row.type, row.id)
                          message.success('节点已删除')
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

      {editing && (
        <NodeEditModal
          open
          protocol={editing.protocol}
          node={editing.node}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </>
  )
}

export default function ServerPage() {
  return (
    <Tabs
      defaultActiveKey="nodes"
      items={[
        { key: 'nodes', label: '节点列表', children: <NodeTable /> },
        { key: 'groups', label: '权限组', children: <ServerGroupPanel /> },
        { key: 'routes', label: '路由规则', children: <ServerRoutePanel /> },
      ]}
    />
  )
}
