import { useEffect, useState } from 'react'
import { Alert, Form, Input, Modal, Space, Spin, Tag, Typography, message } from 'antd'
import { useQuery } from '@tanstack/react-query'
import {
  banUsersByFilter,
  deleteUsersByFilter,
  fetchUsers,
  sendMailByFilter,
  type UserFilter,
} from '@/api/user'

export type BulkAction = 'ban' | 'allDel' | 'sendMail'

interface Props {
  action: BulkAction | null
  /** 当前生效的过滤条件。空数组 = 作用于全部用户 */
  filters: UserFilter[]
  onClose: () => void
  onDone: () => void
}

const ACTION_META: Record<
  BulkAction,
  { title: string; verb: string; danger: boolean; needTypedConfirm: boolean }
> = {
  ban: { title: '批量封禁用户', verb: '封禁', danger: true, needTypedConfirm: false },
  allDel: { title: '批量删除用户', verb: '删除', danger: true, needTypedConfirm: true },
  sendMail: { title: '群发邮件', verb: '发送邮件给', danger: false, needTypedConfirm: false },
}

/**
 * 按「当前筛选结果」批量执行的操作。
 *
 * ⚠️ 这是整个用户管理里最危险的地方，值得把设计理由写下来：
 *
 * 后端的 ban / allDel / sendMail / dumpCSV 都是**按过滤条件**作用的，
 * 不接受 id 列表（UserController.php:305/328/281）。也就是说
 * **不带 filter 调用 allDel 会删掉全库用户**，连同他们的订单、邀请码、工单。
 * 后端也没有"按勾选行批量"的接口，所以前端做不到"只删勾选的几行"。
 *
 * 因此这里的设计原则是：
 *   1. 影响面必须显式写出来（多少个用户、什么条件），不让人凭感觉点确定；
 *   2. 无筛选条件时用最强的警告样式，因为那等于全库操作；
 *   3. 删除要求手动输入数量确认 —— 这个动作不可恢复，多一道摩擦是值得的。
 */
export default function BulkActionModal({
  action,
  filters,
  onClose,
  onDone,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [mailForm] = Form.useForm<{ subject: string; content: string }>()

  /**
   * 影响数量在弹窗打开时**按当前条件重新查一次**，不复用表格的 total。
   *
   * 原因：用户可能改了筛选条件却没点「查询」，此时表格 total 还是旧条件的数字，
   * 而这里执行用的是新条件 —— 显示的数量和真实影响面就会不一致。
   * 删除操作的确认数字必须和实际会被删掉的数量来自同一次查询。
   */
  const { data: scope, isFetching: countingScope } = useQuery({
    queryKey: ['bulk-scope', action, JSON.stringify(filters)],
    queryFn: () =>
      fetchUsers({
        current: 1,
        pageSize: 10,
        filter: filters.length > 0 ? filters : undefined,
      }),
    enabled: action !== null,
    // 每次打开都重新数，不吃缓存
    staleTime: 0,
    gcTime: 0,
  })

  const affectedCount = scope?.total ?? 0

  useEffect(() => {
    setConfirmText('')
    mailForm.resetFields()
  }, [action, mailForm])

  if (!action) return null

  const meta = ACTION_META[action]
  const isWholeDatabase = filters.length === 0
  // 数量还没查回来之前不允许提交，避免对着「0 个用户」点确定
  const confirmOk =
    !countingScope &&
    affectedCount > 0 &&
    (!meta.needTypedConfirm || confirmText.trim() === String(affectedCount))

  async function handleOk() {
    setSubmitting(true)
    try {
      if (action === 'ban') {
        await banUsersByFilter({ filter: filters })
        message.success(`已封禁 ${affectedCount} 个用户`)
      } else if (action === 'allDel') {
        await deleteUsersByFilter({ filter: filters })
        message.success(`已删除 ${affectedCount} 个用户`)
      } else {
        const values = await mailForm.validateFields()
        await sendMailByFilter({
          filter: filters,
          subject: values.subject,
          content: values.content,
        })
        message.success(`已提交群发任务，共 ${affectedCount} 个收件人`)
      }
      onDone()
      onClose()
    } catch {
      // 校验失败由表单自己标红；接口错误由 client.ts 拦截器统一弹出
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title={meta.title}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      okButtonProps={{ danger: meta.danger, disabled: !confirmOk }}
      okText={
        countingScope
          ? '正在统计影响范围…'
          : `确认${meta.verb} ${affectedCount} 个用户`
      }
      width={620}
      destroyOnClose
      maskClosable={false}
    >
      <Spin spinning={countingScope}>
      <Alert
        type={isWholeDatabase ? 'error' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          isWholeDatabase
            ? `没有任何筛选条件 —— 将对全部 ${affectedCount} 个用户执行${meta.verb}`
            : `将对筛选命中的 ${affectedCount} 个用户执行${meta.verb}`
        }
        description={
          <>
            <div style={{ marginBottom: 6 }}>
              这个操作作用于<strong>当前筛选结果</strong>，不是你在表格里勾选的行
              —— 后端没有「按勾选行批量」的接口。
            </div>
            {filters.length > 0 ? (
              <Space wrap size={4}>
                <Typography.Text type="secondary">当前条件：</Typography.Text>
                {filters.map((f, i) => (
                  <Tag key={i} color="blue">
                    {f.key} {f.condition} {String(f.value)}
                  </Tag>
                ))}
              </Space>
            ) : null}
          </>
        }
      />

      {action === 'allDel' && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="删除不可恢复"
          description="除用户本身外，还会一并删除他们的订单、邀请码、工单及工单消息，并解除其他用户对他们的邀请关系。"
        />
      )}

      {action === 'ban' && (
        <Typography.Paragraph type="secondary">
          封禁会同时踢掉这些用户的全部登录会话，他们的订阅将立即不可用。
        </Typography.Paragraph>
      )}

      {action === 'sendMail' && (
        <Form form={mailForm} layout="vertical">
          <Form.Item
            name="subject"
            label="邮件主题"
            rules={[{ required: true, message: '请输入主题' }]}
          >
            <Input placeholder="例如：服务维护通知" />
          </Form.Item>
          <Form.Item
            name="content"
            label="邮件内容"
            rules={[{ required: true, message: '请输入内容' }]}
            extra="使用 notify 邮件模板发送，走 send_email_mass 队列，需要队列进程在运行"
          >
            <Input.TextArea rows={6} placeholder="支持 HTML" />
          </Form.Item>
        </Form>
      )}

      {meta.needTypedConfirm && (
        <Form layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            label={
              <span>
                请输入将被删除的用户数量{' '}
                <Typography.Text code>{affectedCount}</Typography.Text> 以确认
              </span>
            }
            validateStatus={
              confirmText && !confirmOk ? 'error' : undefined
            }
            help={confirmText && !confirmOk ? '数量不匹配' : undefined}
          >
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={String(affectedCount)}
              autoComplete="off"
            />
          </Form.Item>
        </Form>
      )}
      </Spin>
    </Modal>
  )
}
