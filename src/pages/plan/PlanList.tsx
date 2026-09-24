import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Button,
  Card,
  Grid,
  Modal,
  Space,
  Switch,
  Table,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
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
  dropPlan,
  fetchPlans,
  RESET_TRAFFIC_METHODS,
  sortPlans,
  updatePlanFlags,
  type AdminPlan,
} from '@/api/plan'
import RowActions from '@/components/RowActions'
import { formatMoney } from '@/lib/format'
import PlanEditModal from './PlanEditModal'
import './PlanPage.css'

const PRICE_COLUMNS: { key: keyof AdminPlan; label: string }[] = [
  { key: 'month_price', label: '月付' },
  { key: 'quarter_price', label: '季付' },
  { key: 'half_year_price', label: '半年' },
  { key: 'year_price', label: '年付' },
  { key: 'two_year_price', label: '两年' },
  { key: 'three_year_price', label: '三年' },
  { key: 'onetime_price', label: '一次性' },
  { key: 'reset_price', label: '重置包' },
]

/** 表格里的「不限 / 跟随全局 / —」这类占位值：次要色，和真实数值拉开 */
function Muted({ children }: { children: ReactNode }) {
  return <Typography.Text type="secondary">{children}</Typography.Text>
}

export default function PlanList() {
  const qc = useQueryClient()
  const screens = Grid.useBreakpoint()
  // 固定列策略：「套餐」列任何宽度都固定在左边，横向滚到开关 / 操作时也认得出是哪一行。
  // ID 列只在宽屏（≥1200）单独成列并一起固定；再窄时并进套餐名下面的副标题
  // （ID 列不固定而套餐列固定的话，antd 会把套餐列钉在 left: 72px，左边空出一条缝）。
  // 右侧：宽屏只固定「操作」，≥1600 才把「上架 / 可续费」也固定 —— 两侧固定列太宽时
  // 中间可滚动的区域只剩两三列，反而难看。
  const wide = !!screens.xl
  const nameWidth = screens.sm ? 180 : 140
  const pinActions = wide ? ('right' as const) : undefined
  const pinFlags = screens.xxl ? ('right' as const) : undefined
  // scroll.x = 'max-content' 时 antd 用 table-layout: auto，列宽会被长套餐名撑开，
  // 实际宽度就和上面的 width 对不上（下面分组表头的吸附位置也会错）。所以给名称块限一个最大宽度，
  // 超出省略：列宽 − 单元格左右内边距（首列 20 + 14，其余 14 + 14，见 PlanPage.css）
  const nameMaxWidth = nameWidth - (wide ? 28 : 34)
  /** 分组表头（配额 / 售价）的标题吸附在左侧固定列右边，横向滚动时不被固定列盖住 */
  const pinLeftWidth = (wide ? 72 : 0) + nameWidth
  const [editing, setEditing] = useState<AdminPlan | null | undefined>(undefined)
  /** 正在提交的开关，键形如 `${id}:show` / `${id}:renew` */
  const [pendingFlags, setPendingFlags] = useState<ReadonlySet<string>>(() => new Set())

  const { data: plans, isFetching } = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
  })

  const reload = () => qc.invalidateQueries({ queryKey: ['plans'] })

  const sortMutation = useMutation({
    mutationFn: sortPlans,
    onSuccess: () => {
      message.success('顺序已保存')
      reload()
    },
  })

  /**
   * 切上架 / 续费。plan/update 传的是目标值（不是取反），重复提交本身是幂等的；
   * 但开关的 checked 要等列表刷新回来才会变，期间看起来像没点上，容易被连点。
   * 所以请求 + 刷新完成前让这个开关保持 loading（antd 会顺带禁用）。
   */
  async function setFlag(row: AdminPlan, flag: 'show' | 'renew', checked: boolean) {
    const key = `${row.id}:${flag}`
    if (pendingFlags.has(key)) return
    setPendingFlags((s) => new Set(s).add(key))
    try {
      await updatePlanFlags(row.id, { [flag]: checked ? 1 : 0 })
      if (flag === 'show') message.success(checked ? '已上架' : '已下架')
      else message.success(checked ? '已允许续费' : '已禁止续费')
    } catch {
      // 拦截器已提示
    } finally {
      await reload()
      setPendingFlags((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    }
  }

  /** 上下移动。后端 sort 接口要传**全量顺序**，不是只传变动项。 */
  function move(index: number, delta: number) {
    if (!plans) return
    const next = [...plans]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const a = next[index]!
    const b = next[target]!
    next[index] = b
    next[target] = a
    sortMutation.mutate(next.map((p) => p.id))
  }

  function confirmDrop(row: AdminPlan) {
    Modal.confirm({
      title: `删除套餐「${row.name}」？`,
      content:
        '后端会先检查：该套餐下若还有订单或用户，会拒绝删除。当前该套餐有 ' +
        `${row.count} 个有效用户。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await dropPlan(row.id)
        message.success('套餐已删除')
        reload()
      },
    })
  }

  const columns: ColumnsType<AdminPlan> = [
    ...(wide ? [{ title: 'ID', dataIndex: 'id', width: 72, fixed: 'left' as const }] : []),
    {
      title: '套餐',
      dataIndex: 'name',
      width: nameWidth,
      fixed: 'left',
      render: (_, row) => (
        <div className="plan-page-name" style={{ maxWidth: nameMaxWidth }}>
          <span className="plan-page-name-title" title={row.name}>
            {row.name}
          </span>
          <Typography.Text type="secondary" className="plan-page-name-sub">
            {wide ? `权限组 #${row.group_id}` : `ID ${row.id} · 权限组 #${row.group_id}`}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '有效用户',
      dataIndex: 'count',
      width: 88,
      align: 'right',
      render: (v: number) => (v > 0 ? v : <Muted>0</Muted>),
    },
    {
      title: <span className="plan-page-col-group-label">配额</span>,
      className: 'plan-page-col-group',
      children: [
        {
          title: '流量',
          dataIndex: 'transfer_enable',
          width: 96,
          align: 'right',
          render: (v: number) => `${v} GB`,
        },
        {
          title: '设备数',
          dataIndex: 'device_limit',
          width: 80,
          align: 'right',
          render: (v: number | null) => v ?? <Muted>不限</Muted>,
        },
        {
          title: '限速',
          dataIndex: 'speed_limit',
          width: 96,
          align: 'right',
          render: (v: number | null) => (v ? `${v} Mbps` : <Muted>不限</Muted>),
        },
        {
          title: '容量上限',
          dataIndex: 'capacity_limit',
          width: 88,
          align: 'right',
          render: (v: number | null) => v ?? <Muted>不限</Muted>,
        },
        {
          title: '流量重置',
          dataIndex: 'reset_traffic_method',
          width: 124,
          render: (v: number | null) =>
            v === null ? (
              <Muted>跟随全局</Muted>
            ) : (
              (RESET_TRAFFIC_METHODS[v as keyof typeof RESET_TRAFFIC_METHODS] ?? v)
            ),
        },
      ],
    },
    {
      title: <span className="plan-page-col-group-label">售价</span>,
      className: 'plan-page-col-group',
      children: PRICE_COLUMNS.map((c) => ({
        title: c.label,
        dataIndex: c.key as string,
        width: 100,
        align: 'right' as const,
        render: (v: number | null) =>
          v === null || v === undefined ? <Muted>—</Muted> : formatMoney(v),
      })),
    },
    {
      title: '上架',
      dataIndex: 'show',
      width: 72,
      align: 'center',
      fixed: pinFlags,
      render: (_, row) => (
        <Switch
          size="small"
          checked={row.show === 1}
          loading={pendingFlags.has(`${row.id}:show`)}
          onChange={(checked) => void setFlag(row, 'show', checked)}
        />
      ),
    },
    {
      title: '可续费',
      dataIndex: 'renew',
      width: 80,
      align: 'center',
      fixed: pinFlags,
      render: (_, row) => (
        <Switch
          size="small"
          checked={row.renew === 1}
          loading={pendingFlags.has(`${row.id}:renew`)}
          onChange={(checked) => void setFlag(row, 'renew', checked)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 172,
      fixed: pinActions,
      render: (_, row, index) => (
        <RowActions
          inline={4}
          actions={[
            {
              key: 'edit',
              label: '编辑',
              icon: <EditOutlined />,
              onClick: () => setEditing(row),
            },
            {
              key: 'up',
              label: '上移',
              icon: <ArrowUpOutlined />,
              iconOnly: true,
              disabled: index === 0,
              onClick: () => move(index, -1),
            },
            {
              key: 'down',
              label: '下移',
              icon: <ArrowDownOutlined />,
              iconOnly: true,
              disabled: index === (plans?.length ?? 0) - 1,
              onClick: () => move(index, 1),
            },
            {
              key: 'drop',
              label: '删除',
              icon: <DeleteOutlined />,
              iconOnly: true,
              danger: true,
              onClick: () => confirmDrop(row),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <>
      <Card
        className="plan-page-card"
        title={
          <span className="plan-page-card-title">
            <span>全部套餐</span>
            {screens.sm && (
              <Typography.Text type="secondary" className="plan-page-card-hint">
                流量单位是 GB，价格单位是元（后端存分），用箭头调整展示顺序
              </Typography.Text>
            )}
          </span>
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
              新增套餐
            </Button>
          </Space>
        }
      >
        <Table<AdminPlan>
          className="plan-page-table tabular-nums"
          rowKey="id"
          loading={isFetching || sortMutation.isPending}
          dataSource={plans ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          style={{ '--plan-pin-left': `${pinLeftWidth + 16}px` } as CSSProperties}
          columns={columns}
        />
      </Card>

      <PlanEditModal
        open={editing !== undefined}
        plan={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={reload}
      />
    </>
  )
}
