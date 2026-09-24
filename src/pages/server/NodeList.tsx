import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Dropdown,
  Modal,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import ProTable, { type ProColumns } from '@ant-design/pro-table'
import {
  BranchesOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  copyNode,
  dropNode,
  fetchNodes,
  fetchServerGroups,
  fetchServerRoutes,
  SERVER_PROTOCOLS,
  updateNodeShow,
  type ServerNode,
  type ServerProtocol,
} from '@/api/server'
import { formatTime } from '@/lib/format'
import RowActions from '@/components/RowActions'
import { PROTOCOL_COLORS, PROTOCOL_LABELS, PROTOCOL_SHORT_LABELS } from './protocolSchema'
import NodeEditModal from './NodeEditModal'
import ServerGroupPanel from './ServerGroupPanel'
import ServerRoutePanel from './ServerRoutePanel'
import './ServerPage.css'

type DotStatus = 'success' | 'warning' | 'error' | 'default'

/**
 * 节点运行状态。available_status 由后端 mergeData 附加：
 *   0 = 最近 5 分钟没有心跳（未运行）
 *   1 = 有心跳但最近 5 分钟没上报流量（未使用或异常）
 *   2 = 运行正常
 * 老数据没有这个字段时退回看 last_push_at。
 */
function nodeStatus(row: ServerNode): { status: DotStatus; text: string } {
  switch (row.available_status) {
    case 2:
      return { status: 'success', text: '运行正常' }
    case 1:
      return { status: 'warning', text: '无流量（未使用或异常）' }
    case 0:
      return { status: 'error', text: '未运行' }
    default:
      return row.last_push_at
        ? { status: 'success', text: '运行正常' }
        : { status: 'default', text: '从未上报数据' }
  }
}

/** 一行放得下的 #id 标签组，超出的收成 +N（悬停看全部），保证行高一致 */
function IdTags({ ids, max = 3 }: { ids: number[]; max?: number }) {
  const shown = ids.slice(0, max)
  const rest = ids.slice(max)
  return (
    <span className="server-page-tags">
      {shown.map((g) => (
        <Tag key={g} bordered={false}>
          #{g}
        </Tag>
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.map((g) => `#${g}`).join('、')}>
          <Tag bordered={false}>+{rest.length}</Tag>
        </Tooltip>
      )}
    </span>
  )
}

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

  // 预取权限组 / 路由规则（和编辑弹窗、另外两个标签页同一个 queryKey）：
  // 弹窗打开时选项已在缓存里，多选框不会先闪一下裸 ID 再变成名称
  useQuery({ queryKey: ['server-groups'], queryFn: fetchServerGroups })
  useQuery({ queryKey: ['server-routes'], queryFn: fetchServerRoutes })

  /** 各协议的节点数，用于新增菜单里的计数 */
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of nodes ?? []) {
      map.set(n.type, (map.get(n.type) ?? 0) + 1)
    }
    return map
  }, [nodes])

  /** 标题行的运行状态汇总 */
  const summary = useMemo(() => {
    const s = { success: 0, warning: 0, down: 0 }
    for (const n of nodes ?? []) {
      const st = nodeStatus(n).status
      if (st === 'success') s.success += 1
      else if (st === 'warning') s.warning += 1
      else s.down += 1
    }
    return s
  }, [nodes])

  const columns: ProColumns<ServerNode>[] = [
    {
      title: '节点',
      dataIndex: 'name',
      width: 172,
      render: (_, row) => {
        const st = nodeStatus(row)
        return (
          <span className="server-page-node">
            <Tooltip
              title={
                <>
                  {st.text}
                  <br />
                  最后心跳 {formatTime(row.last_check_at, '—')}
                  <br />
                  最后上报 {formatTime(row.last_push_at, '—')}
                </>
              }
            >
              <span className="server-page-node-dot">
                <Badge status={st.status} />
              </span>
            </Tooltip>
            <Typography.Text
              className="server-page-node-name"
              ellipsis={{ tooltip: row.name }}
            >
              {row.name}
            </Typography.Text>
            {row.parent_id ? (
              <Tooltip title={`子节点，共享父节点 #${row.parent_id} 的流量统计`}>
                <Tag bordered={false} color="processing">
                  子节点
                </Tag>
              </Tooltip>
            ) : null}
            {row.show !== 1 && (
              <Tooltip title="已隐藏：用户端看不到这个节点">
                <EyeInvisibleOutlined className="server-page-hidden-icon" aria-label="已隐藏" />
              </Tooltip>
            )}
          </span>
        )
      },
    },
    {
      // 各协议的 ID 各自从 1 起，单独一列没意义，跟在协议后面（「父节点 ID」填的就是它）
      title: '协议 / ID',
      dataIndex: 'type',
      width: 144,
      filters: SERVER_PROTOCOLS.map((p) => ({
        text: (
          <span className="server-page-filter-item">
            <Badge color={PROTOCOL_COLORS[p]} />
            {PROTOCOL_SHORT_LABELS[p]}
          </span>
        ),
        value: p,
      })),
      onFilter: (value, row) => row.type === value,
      // 8 个协议正好比默认的 264px 高一点，放开高度免得最后一项要在下拉里再滚动
      filterDropdownProps: { rootClassName: 'server-page-filter-dropdown' },
      render: (_, row) => (
        <span className="server-page-proto-cell">
          <Tag
            bordered={false}
            color={PROTOCOL_COLORS[row.type]}
            className="server-page-proto"
            data-proto={row.type}
          >
            {PROTOCOL_SHORT_LABELS[row.type] ?? row.type}
          </Tag>
          <Typography.Text type="secondary" className="server-page-proto-id">
            #{row.id}
          </Typography.Text>
        </span>
      ),
    },
    {
      // 不给宽度：表格变宽时多出来的空间都给这一列。主机名过长只截主机名，端口永远可见
      title: '连接地址',
      dataIndex: 'host',
      render: (_, row) => (
        <span className="server-page-addr">
          <Typography.Text
            className="mono server-page-addr-host"
            ellipsis={{ tooltip: row.host }}
          >
            {row.host}
          </Typography.Text>
          <span className="mono server-page-addr-port">:{row.port}</span>
          <Typography.Text
            className="server-page-addr-copy"
            copyable={{
              text: `${row.host}:${row.port}`,
              tooltips: ['复制地址', '已复制'],
            }}
          />
        </span>
      ),
    },
    {
      title: '服务端口',
      dataIndex: 'server_port',
      width: 84,
      align: 'right',
      render: (_, row) => <span className="tabular-nums">{row.server_port}</span>,
    },
    {
      title: '倍率',
      dataIndex: 'rate',
      width: 60,
      align: 'right',
      render: (_, row) => {
        const r = Number(row.rate)
        return (
          <Typography.Text
            className="tabular-nums"
            type={r > 1 ? 'warning' : r < 1 ? 'success' : undefined}
          >
            {row.rate}×
          </Typography.Text>
        )
      },
    },
    {
      title: '在线',
      dataIndex: 'online',
      width: 60,
      align: 'right',
      render: (_, row) =>
        row.online === null || row.online === undefined ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <span className="tabular-nums">{row.online}</span>
        ),
    },
    {
      title: '显示',
      dataIndex: 'show',
      width: 56,
      align: 'center',
      render: (_, row) => (
        <Switch
          size="small"
          checked={row.show === 1}
          aria-label={row.show === 1 ? '隐藏节点' : '显示节点'}
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
      title: '权限组',
      dataIndex: 'group_id',
      width: 130,
      render: (_, row) =>
        row.group_id && row.group_id.length > 0 ? (
          <IdTags ids={row.group_id} />
        ) : (
          <Typography.Text type="danger">未分配</Typography.Text>
        ),
    },
    {
      title: '操作',
      key: 'option',
      valueType: 'option',
      width: 132,
      fixed: 'right',
      render: (_, row) => (
        <RowActions
          inline={2}
          actions={[
            {
              key: 'edit',
              label: '编辑',
              icon: <EditOutlined />,
              onClick: () => setEditing({ protocol: row.type, node: row }),
            },
            {
              key: 'copy',
              label: '复制一份（副本默认隐藏）',
              icon: <CopyOutlined />,
              iconOnly: true,
              onClick: async () => {
                await copyNode(row.type, row.id)
                message.success('已复制，副本默认为隐藏状态')
                reload()
              },
            },
            {
              key: 'delete',
              label: '删除节点',
              icon: <DeleteOutlined />,
              danger: true,
              iconOnly: true,
              onClick: () =>
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
                }),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <>
      <ProTable<ServerNode>
        rowKey={(row) => `${row.type}-${row.id}`}
        loading={isFetching}
        dataSource={nodes ?? []}
        columns={columns}
        search={false}
        pagination={false}
        // 除「连接地址」外各列宽度之和 838 + 地址至少 180
        scroll={{ x: 1020 }}
        rowClassName={(row) => (row.show === 1 ? '' : 'server-page-row-hidden')}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        headerTitle={
          <span className="server-page-title">
            <span>全部节点</span>
            <Typography.Text
              type="secondary"
              className="server-page-title-sub server-page-title-sub-collapsible"
            >
              共 {nodes?.length ?? 0} 个 · 按排序值升序
            </Typography.Text>
            <span className="server-page-summary">
              <Tooltip title="最近 5 分钟有心跳，也有流量上报">
                <Badge status="success" text={`正常 ${summary.success}`} />
              </Tooltip>
              <Tooltip title="有心跳，但最近 5 分钟没有上报流量（未使用或异常）">
                <Badge status="warning" text={`无流量 ${summary.warning}`} />
              </Tooltip>
              <Tooltip title="最近 5 分钟没有心跳，或从未上报过数据">
                <Badge status="error" text={`未运行 ${summary.down}`} />
              </Tooltip>
            </span>
          </span>
        }
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>,
          <Dropdown
            key="add"
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                {
                  type: 'group',
                  label: '选择协议',
                  children: SERVER_PROTOCOLS.map((p) => ({
                    key: p,
                    icon: <Badge color={PROTOCOL_COLORS[p]} />,
                    label: (
                      <span className="server-page-add-item">
                        <span>{PROTOCOL_LABELS[p]}</span>
                        <span className="server-page-add-count">
                          {counts.get(p) ? `现有 ${counts.get(p)}` : '—'}
                        </span>
                      </span>
                    ),
                  })),
                },
              ],
              onClick: ({ key }) =>
                setEditing({ protocol: key as ServerProtocol, node: null }),
            }}
          >
            <Button type="primary" icon={<PlusOutlined />}>
              <Space size={6}>
                新增节点
                <DownOutlined style={{ fontSize: 11 }} />
              </Space>
            </Button>
          </Dropdown>,
        ]}
      />

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
        {
          key: 'nodes',
          label: '节点列表',
          icon: <CloudServerOutlined />,
          children: <NodeTable />,
        },
        {
          key: 'groups',
          label: '权限组',
          icon: <TeamOutlined />,
          children: <ServerGroupPanel />,
        },
        {
          key: 'routes',
          label: '路由规则',
          icon: <BranchesOutlined />,
          children: <ServerRoutePanel />,
        },
      ]}
    />
  )
}
