import { useRef, useState, type ReactNode } from 'react'
import ProTable, { type ActionType } from '@ant-design/pro-table'
import { Badge, Button, Grid, Modal, Tag, Tooltip, Typography, message } from 'antd'
import {
  ArrowRightOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { ADMIN_ENDPOINTS } from '@/api/endpoints'
import { proTableRequest } from '@/api/request'
import { fetchPlans } from '@/api/plan'
import {
  dropGiftcard,
  GIFTCARD_TYPES,
  parseJsonArray,
  type AdminGiftcard,
} from '@/api/promo'
import { formatMoney, formatTime } from '@/lib/format'
import RowActions from '@/components/RowActions'
import GiftcardCreateModal from './GiftcardCreateModal'
import './PromoPages.css'

/**
 * 已兑换人数 = used_user_ids 的长度。
 * 模型 cast 成 array，fetch 可能直接返回数组；兑换逻辑又会双重编码，也可能是 JSON 字符串。
 * 以前只认字符串，遇到数组一律算 0，已兑换数永远显示 0。
 */
function usedCount(raw: AdminGiftcard['used_user_ids']): number {
  return parseJsonArray(raw).length
}

/** 各类型面值标签的颜色（永久套餐卡另用红色）。都用有底色的颜色：default 的底色和行背景几乎一样，标签看不出来 */
const TYPE_COLOR: Record<number, string> = {
  1: 'blue',
  2: 'cyan',
  3: 'geekblue',
  4: 'gold',
  5: 'purple',
}

/** 各类型 value 的显示口径，取自 GiftcardController::multiGenerate 的 CSV 逻辑 */
function ValueCell({ row, planName }: { row: AdminGiftcard; planName: (id: number) => string }) {
  const v = row.value ?? 0
  const typeLabel = GIFTCARD_TYPES[row.type as keyof typeof GIFTCARD_TYPES] ?? String(row.type)
  let main: ReactNode
  let sub: ReactNode = typeLabel
  switch (row.type) {
    case 1:
      main = formatMoney(v)
      break
    case 2:
      main = `${v} 天`
      break
    case 3:
      main = `${v} GB`
      break
    case 4:
      main = '重置流量'
      // 主标签已经说明了类型，下面不再重复「流量重置」
      sub = '无面值'
      break
    case 5: {
      sub = `${typeLabel} · ${row.plan_id == null ? '套餐 #?' : planName(row.plan_id)}`
      // UserController::redeemgiftcard：value == 0 时把 expired_at 置空 = 永久套餐
      // （PHP 里 null == 0 也成立，所以 null 同样按永久算）。后端 CSV 会把它写成「0天」，
      // 这里必须醒目标出，否则审计时会被当成一张无效卡。
      if (v === 0) {
        return (
          <Tooltip title="兑换后用户获得该套餐的永久订阅（到期时间置空）">
            <div className="promo-cell">
              <Tag bordered={false} color="red" className="promo-value-tag">
                永久
              </Tag>
              <span className="promo-sub">{sub}</span>
            </div>
          </Tooltip>
        )
      }
      main = `${v} 天`
      break
    }
    default:
      main = String(v)
  }
  return (
    <div className="promo-cell">
      <Tag bordered={false} color={TYPE_COLOR[row.type]} className="promo-value-tag">
        {main}
      </Tag>
      <span className="promo-sub">{sub}</span>
    </div>
  )
}

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

export default function GiftcardList() {
  const tableRef = useRef<ActionType>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // 只用来把套餐时长卡的 plan_id 显示成套餐名（和生成弹窗共用同一份缓存）；没拉到时退回显示 #id
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: fetchPlans })
  const planName = (id: number) =>
    plans?.find((p) => String(p.id) === String(id))?.name ?? `套餐 #${id}`

  // 手机上不固定「操作」列：固定列会占掉 390px 宽表格的一大块可视宽度，把名称和卡密挡住。
  // useBreakpoint 首次渲染返回 {}，先用 matchMedia 同步判断，免得手机上先固定再松开闪一下
  const screens = Grid.useBreakpoint()
  const pinActions = screens.md ?? window.matchMedia('(min-width: 768px)').matches

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
          {
            title: 'ID',
            dataIndex: 'id',
            width: 60,
            sorter: true,
            render: (_, row) => <span className="tabular-nums muted">{row.id}</span>,
          },
          {
            // 卡密并进名称下面一行：各列本来就是两行，行高不变，省下一整列给名称，宽屏下不再被截断
            title: '名称 / 卡密',
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
                  copyable={{ text: row.code, tooltips: ['复制卡密', '已复制'] }}
                >
                  <span className="promo-code-text">{row.code}</span>
                </Typography.Text>
              </div>
            ),
          },
          {
            title: '类型 / 面值',
            dataIndex: 'type',
            width: 180,
            render: (_, row) => <ValueCell row={row} planName={planName} />,
          },
          {
            // limit_use 每兑换一次后端就减 1（redeemgiftcard），是剩余次数，不是上限
            title: '已兑换 / 剩余',
            width: 120,
            align: 'right',
            // 右对齐的数字紧挨着左对齐的有效期，右边多留一点空
            className: 'promo-usage-col',
            render: (_, row) => {
              const used = usedCount(row.used_user_ids)
              const left = row.limit_use
              return (
                <Tooltip
                  title={left == null ? '不限次数' : `已兑换 ${used} 次，还可兑换 ${left} 次`}
                >
                  <span className="promo-usage">
                    <span className="promo-usage-used">{used}</span>
                    <span className="promo-usage-sep"> / </span>
                    <span className={`promo-usage-left${left === 0 ? ' is-empty' : ''}`}>
                      {left ?? '∞'}
                    </span>
                  </span>
                </Tooltip>
              )
            },
          },
          {
            title: '有效期',
            width: 216,
            render: (_, row) => <ValidityCell start={row.started_at} end={row.ended_at} />,
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            width: 136,
            render: (_, row) => <span className="promo-time">{formatTime(row.created_at)}</span>,
          },
          {
            title: '操作',
            key: 'actions',
            width: 64,
            fixed: pinActions ? 'right' : undefined,
            render: (_, row) => (
              <RowActions
                actions={[
                  {
                    key: 'del',
                    label: '删除',
                    icon: <DeleteOutlined />,
                    danger: true,
                    // 和优惠券列表一致：只显示红色图标（悬停提示「删除」），整列红字太抢眼
                    iconOnly: true,
                    onClick: () =>
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
          showTotal: (t) => `共 ${t} 张卡`,
        }}
        search={false}
        options={{ density: false, fullScreen: true, setting: true, reload: false }}
        scroll={{ x: 980 }}
        // 手机上操作列不固定时 antd 会退回 auto 布局、按内容撑列宽，名称的省略号就失效了
        tableLayout="fixed"
        headerTitle={
          <span className="promo-card-title">
            <span>全部礼品卡</span>
            <Typography.Text type="secondary" className="promo-card-desc">
              本 fork 自定义功能，上游 v2board 没有
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
