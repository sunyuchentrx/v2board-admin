import { useRef, useState } from 'react'
import ProTable, { type ActionType, type ColumnsState } from '@ant-design/pro-table'
import { Badge, Button, Grid, Modal, Switch, Tag, Tooltip, Typography, message } from 'antd'
import {
  ArrowRightOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import { fetchPlans } from '@/api/plan'
import { ORDER_PERIODS } from '@/api/order'
import {
  COUPON_TYPES,
  describeCouponRate,
  dropCoupon,
  parseJsonArray,
  toggleCouponShow,
  type AdminCoupon,
} from '@/api/promo'
import { formatMoney, formatTime } from '@/lib/format'
import RowActions from '@/components/RowActions'
import CouponEditModal from './CouponEditModal'
import './PromoPages.css'

type SortOrder = Record<string, 'ascend' | 'descend' | null>

/** 有效期单元格：一行日期区间 + 一行状态（未开始 / 生效中 / 即将到期 / 已过期） */
function ValidityCell({ start, end }: { start: number; end: number }) {
  const now = Date.now() / 1000
  let status: 'success' | 'processing' | 'warning' | 'default' = 'success'
  let text = '生效中'
  if (now < start) {
    status = 'processing'
    text = '未开始'
  } else if (now > end) {
    status = 'default'
    text = '已过期'
  } else if (end - now < 7 * 86400) {
    status = 'warning'
    text = `${Math.max(1, Math.ceil((end - now) / 86400))} 天后到期`
  }
  return (
    <Tooltip title={`${formatTime(start)} 至 ${formatTime(end)}`}>
      <div className="promo-cell">
        <span className="promo-range">
          {dayjs(start * 1000).format('YYYY-MM-DD')}
          <ArrowRightOutlined className="promo-range-arrow" />
          {dayjs(end * 1000).format('YYYY-MM-DD')}
        </span>
        <Badge className="promo-status" status={status} text={text} />
      </div>
    </Tooltip>
  )
}

/**
 * 限定范围的一行：标签 + 第一个 Tag，其余收进「+N」（悬停看全部），避免行高被撑得参差不齐。
 * 固定只放一个：两个稍长的套餐名（「月付 Pro」「月付 Ultra」）在这一列里放不下，会折成两行。
 */
function ScopeLine({ label, items }: { label: string; items: string[] }) {
  const shown = items.slice(0, 1)
  const rest = items.slice(shown.length)
  return (
    <div className="promo-scope">
      <span className="promo-scope-label">{label}</span>
      {/* 只有一个时不弹提示（内容就是标签本身），名字太长被省略时靠原生 title 看全名 */}
      <Tooltip title={rest.length > 0 ? items.join('、') : undefined}>
        <span className="promo-scope-tags">
          {shown.map((item, i) => (
            <Tag key={`${item}-${i}`} bordered={false} title={rest.length > 0 ? undefined : item}>
              {item}
            </Tag>
          ))}
          {rest.length > 0 && (
            <Tag bordered={false} className="promo-scope-more">
              +{rest.length}
            </Tag>
          )}
        </span>
      </Tooltip>
    </div>
  )
}

type ColumnsStateMap = Record<string, ColumnsState>

/** 断点决定「操作」列固不固定（键是下面列定义里的 key 'actions'），只改这一列的 fixed */
function withPinnedActions(map: ColumnsStateMap, pinned: boolean): ColumnsStateMap {
  return { ...map, actions: { ...map.actions, fixed: pinned ? 'right' : undefined } }
}

export default function CouponList() {
  const tableRef = useRef<ActionType>(null)
  const [editing, setEditing] = useState<AdminCoupon | null | undefined>(undefined)
  // 正在切换启用状态的券 id。ref 做同步守卫（setState 是异步的，同一帧里连点两下 state 挡不住），
  // state 只用来驱动开关的 loading 显示。
  const togglingRef = useRef(new Set<number>())
  const [toggling, setToggling] = useState<ReadonlySet<number>>(new Set())
  // 最近一次列表请求的参数，切换前按同样的分页/排序重新拉一次当前页做核对
  const lastQueryRef = useRef<{ params: Record<string, unknown>; sort?: SortOrder }>({
    params: {},
  })

  // 只用来把「限定套餐」的 id 显示成套餐名（和编辑弹窗共用同一份缓存）；没拉到时退回显示 #id
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: fetchPlans })
  const planName = (id: string | number) =>
    plans?.find((p) => String(p.id) === String(id))?.name ?? `#${id}`

  // 手机上不固定「操作」列：固定列会占掉 390px 宽表格约三分之一的可视宽度，把名称和券码挡住。
  // useBreakpoint 首次渲染返回 {}，先用 matchMedia 同步判断，免得手机上先固定再松开闪一下
  const screens = Grid.useBreakpoint()
  const pinActions = screens.md ?? window.matchMedia('(min-width: 768px)').matches
  // ProTable 只在挂载时从列定义读一次 fixed、之后以列设置状态为准，所以把列设置状态受控：
  // 断点变了只改操作列的 fixed（跨断点缩放窗口时也能跟着变），用户在列设置里调过的显隐、顺序原样保留
  const [columnsState, setColumnsState] = useState<ColumnsStateMap>(() =>
    withPinnedActions({}, pinActions),
  )
  const [pinnedFor, setPinnedFor] = useState(pinActions)
  if (pinnedFor !== pinActions) {
    // 渲染期间按新断点调整状态（React 推荐的写法，比 useEffect 少一次用旧值渲染）
    setPinnedFor(pinActions)
    setColumnsState((s) => withPinnedActions(s, pinActions))
  }

  const reload = () => tableRef.current?.reload()

  function markToggling(id: number, on: boolean) {
    if (on) togglingRef.current.add(id)
    else togglingRef.current.delete(id)
    setToggling(new Set(togglingRef.current))
  }

  /**
   * 切换启用状态。
   *
   * 后端 coupon/show 是取反（$coupon->show = $coupon->show ? 0 : 1），不收目标值，所以：
   *   - 请求期间必须锁住开关：受控 Switch 在 reload 完成前不会变，没有 loading 时管理员会再点一次，
   *     两次取反等于没改（例如急着停用泄露的券码，结果券仍然启用）；
   *   - 列表可能是旧数据（同事或另一个标签页刚改过），这时点「停用」实际会把券重新启用。
   *     所以先按同样的分页/排序重新拉一次当前页核对，不一致就放弃本次操作并刷新。
   *     这只能把竞态窗口缩到毫秒级，彻底解决需要后端接受目标值。
   */
  async function toggleShow(row: AdminCoupon) {
    if (togglingRef.current.has(row.id)) return
    markToggling(row.id, true)
    try {
      const { params, sort } = lastQueryRef.current
      const fresh = await proTableRequest<AdminCoupon>(
        ADMIN_ENDPOINTS.coupon.fetch,
        params,
        sort,
      )
      if (!fresh.success) return // 拦截器已提示
      const current = fresh.data.find((c) => c.id === row.id)
      if (!current) {
        message.warning('列表已变化（可能有券被新增或删除），已刷新，请重新操作')
        await reload()
        return
      }
      if (current.show !== row.show) {
        message.warning('这张券的启用状态已在别处被修改，已刷新为最新状态，请确认后再操作')
        await reload()
        return
      }
      await toggleCouponShow(row.id)
      message.success(row.show === 1 ? '已停用' : '已启用')
      // 等列表刷新完再解锁，否则刷新期间开关仍显示旧状态，还能再被点一次
      await reload()
    } catch {
      // 拦截器已提示
    } finally {
      markToggling(row.id, false)
    }
  }

  return (
    <>
      <ProTable<AdminCoupon>
        actionRef={tableRef}
        rowKey="id"
        request={async (params, sort) => {
          const query = { current: params.current, pageSize: params.pageSize }
          lastQueryRef.current = { params: query, sort: sort as SortOrder }
          return proTableRequest<AdminCoupon>(
            ADMIN_ENDPOINTS.coupon.fetch,
            query,
            sort as SortOrder,
          ) as Promise<{ data: AdminCoupon[]; total: number; success: boolean }>
        }}
        columns={[
          {
            title: 'ID',
            dataIndex: 'id',
            width: 60,
            sorter: true,
            render: (_, row) => <span className="tabular-nums muted">{row.id}</span>,
          },
          {
            // 券码并进名称下面一行：各列本来就是两行，行高不变，省下一整列给名称，宽屏下不再被截断
            title: '名称 / 券码',
            dataIndex: 'name',
            className: 'promo-name-col',
            render: (_, row) => (
              <div className="promo-cell">
                {/* 太长才省略，悬停显示全名 */}
                <Typography.Text className="promo-name" ellipsis={{ tooltip: row.name }}>
                  {row.name}
                </Typography.Text>
                <Typography.Text
                  className="promo-code"
                  copyable={{ text: row.code, tooltips: ['复制券码', '已复制'] }}
                >
                  <span className="promo-code-text">{row.code}</span>
                </Typography.Text>
              </div>
            ),
          },
          {
            title: '优惠',
            dataIndex: 'type',
            width: 146,
            render: (_, row) => (
              <div className="promo-cell">
                {/* type=1 存的是分；type=2 存的是减免百分比（填 10 = 九折），不是「几折」 */}
                <Tag
                  bordered={false}
                  color={row.type === 1 ? 'blue' : 'purple'}
                  className="promo-value-tag"
                >
                  {row.type === 1
                    ? formatMoney(row.value)
                    : `减 ${row.value}%（${describeCouponRate(row.value)}）`}
                </Tag>
                <span className="promo-sub">
                  {COUPON_TYPES[row.type as keyof typeof COUPON_TYPES] ?? row.type}
                </span>
              </div>
            ),
          },
          {
            title: '使用限制',
            width: 92,
            render: (_, row) => (
              <div className="promo-kv">
                {/* limit_use 每用一次后端减 1，是剩余次数 */}
                <span className="promo-kv-label">剩余</span>
                <span className={`promo-kv-value${row.limit_use === 0 ? ' is-empty' : ''}`}>
                  {row.limit_use ?? '不限'}
                </span>
                <span className="promo-kv-label">每人</span>
                <span className="promo-kv-value">{row.limit_use_with_user ?? '不限'}</span>
              </div>
            ),
          },
          {
            title: '限定范围',
            width: 150,
            render: (_, row) => {
              const planIds = parseJsonArray(row.limit_plan_ids)
              const periods = parseJsonArray(row.limit_period)
              if (planIds.length === 0 && periods.length === 0) {
                return <Typography.Text type="secondary">不限</Typography.Text>
              }
              return (
                <div className="promo-cell">
                  {planIds.length > 0 && (
                    <ScopeLine label="套餐" items={planIds.map((id) => planName(id))} />
                  )}
                  {periods.length > 0 && (
                    <ScopeLine
                      label="周期"
                      items={periods.map(
                        (p) => ORDER_PERIODS[p as keyof typeof ORDER_PERIODS] ?? String(p),
                      )}
                    />
                  )}
                </div>
              )
            },
          },
          {
            title: '有效期',
            width: 216,
            render: (_, row) => <ValidityCell start={row.started_at} end={row.ended_at} />,
          },
          {
            title: '启用',
            dataIndex: 'show',
            width: 60,
            render: (_, row) => (
              <Switch
                size="small"
                checked={row.show === 1}
                // 后端是取反，不接受目标值；请求 + 刷新期间锁住，见 toggleShow
                loading={toggling.has(row.id)}
                disabled={toggling.has(row.id)}
                onChange={() => void toggleShow(row)}
              />
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 112,
            fixed: pinActions ? 'right' : undefined,
            render: (_, row) => (
              <RowActions
                actions={[
                  {
                    key: 'edit',
                    label: '编辑',
                    icon: <EditOutlined />,
                    onClick: () => setEditing(row),
                  },
                  {
                    key: 'del',
                    label: '删除',
                    icon: <DeleteOutlined />,
                    danger: true,
                    iconOnly: true,
                    onClick: () =>
                      Modal.confirm({
                        title: `删除优惠券「${row.name}」？`,
                        content: '已使用过的记录不会回滚，只是这张券今后不能再用。',
                        okText: '确认删除',
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await dropCoupon(row.id)
                          message.success('已删除')
                          reload()
                        },
                      }),
                  },
                ]}
              />
            ),
          },
        ]}
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 张券`,
        }}
        columnsState={{
          value: columnsState,
          onChange: setColumnsState,
          // 列设置里的「重置」回到当前断点的默认值
          defaultValue: withPinnedActions({}, pinActions),
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        scroll={{ x: 1040 }}
        // 手机上操作列不固定时 antd 会退回 auto 布局、按内容撑列宽，名称的省略号就失效了
        tableLayout="fixed"
        headerTitle={
          <span className="promo-card-title">
            <span>全部优惠券</span>
            <Typography.Text type="secondary" className="promo-card-desc">
              比例券按原价减免：减 10% = 9 折
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
            onClick={() => setEditing(null)}
          >
            新增 / 批量生成
          </Button>,
        ]}
      />

      <CouponEditModal
        open={editing !== undefined}
        coupon={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={reload}
      />
    </>
  )
}
