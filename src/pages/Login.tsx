import { useState } from 'react'
import { Button, Card, Form, Input, Typography, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { ApiError } from '@/api/client'
import { NotAdminError, useAuth } from '@/auth/AuthContext'
import { settings } from '@/settings'

interface LoginForm {
  email: string
  password: string
}

export default function Login() {
  const { signIn } = useAuth()
  const [form] = Form.useForm<LoginForm>()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(values: LoginForm) {
    setSubmitting(true)
    try {
      await signIn(values.email, values.password)
      message.success('登录成功')
    } catch (error) {
      if (error instanceof NotAdminError) {
        // 客户端判定，不经过 axios 拦截器，这里必须自己提示
        message.error(error.message)
      } else if (error instanceof ApiError && error.status === 422) {
        // 拦截器刻意不弹 422，逐字段错误落到表单上。
        // 后端返回的 key 是任意字符串，只认本表单确实存在的字段，其余走兜底提示。
        const formFields: (keyof LoginForm)[] = ['email', 'password']
        const fields = Object.entries(error.fieldErrors ?? {})
          .filter(([name]) => formFields.includes(name as keyof LoginForm))
          .map(([name, errors]) => ({
            name: name as keyof LoginForm,
            errors,
          }))
        if (fields.length > 0) {
          form.setFields(fields)
        } else {
          message.error(error.message)
        }
      }
      // 其余错误（含密码错误的 HTTP 500）已由拦截器统一弹出，不重复提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {settings.logo ? (
            <img
              src={settings.logo}
              alt={settings.title}
              style={{ height: 40, marginBottom: 12 }}
            />
          ) : null}
          <Typography.Title level={4} style={{ margin: 0 }}>
            {settings.title}
          </Typography.Title>
          <Typography.Text type="secondary">管理后台</Typography.Text>
        </div>

        <Form<LoginForm>
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
        >
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="admin@example.com"
              autoComplete="username"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              // 后端 AuthLogin.php 要求至少 8 位，前端先挡一道省一次往返
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请输入密码"
              autoComplete="current-password"
              size="large"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            size="large"
            block
          >
            登录
          </Button>
        </Form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            v{settings.version}
          </Typography.Text>
        </div>
      </Card>
    </div>
  )
}
