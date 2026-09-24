import { useState } from 'react'
import { Button, Form, Input, Typography, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { ApiError } from '@/api/client'
import { NotAdminError, useAuth } from '@/auth/AuthContext'
import { settings } from '@/settings'
import './Login.css'

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
        // 登录请求带了 handle422（api/auth.ts），拦截器不弹 422，逐字段错误落到表单上。
        // 后端返回的 key 是任意字符串，只认本表单确实存在的字段，其余走兜底提示
        // （error.message 已被拦截器换成第一条字段错误，不是 Laravel 那句英文套话）。
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
      // 其余错误（含密码错误的 HTTP 500、超时）已由拦截器统一弹出，不重复提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="login-page"
      style={
        settings.backgroundUrl
          ? { backgroundImage: `url(${JSON.stringify(settings.backgroundUrl)})` }
          : undefined
      }
    >
      <div className="login-panel">
        <div className="login-brand">
          {settings.logo ? (
            // no-referrer：logo 常放在外部图床，别让 Referer 把后台地址（secure_path）带过去
            <img className="login-logo" src={settings.logo} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="login-mark">
              {(settings.title || 'V').trim().charAt(0).toUpperCase()}
            </span>
          )}
          <Typography.Title level={3} className="login-title">
            {settings.title}
          </Typography.Title>
          <Typography.Text type="secondary">登录管理后台</Typography.Text>
        </div>

        <Form<LoginForm>
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
          size="large"
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
              prefix={<UserOutlined className="login-input-icon" />}
              placeholder="admin@example.com"
              autoComplete="username"
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
              prefix={<LockOutlined className="login-input-icon" />}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            block
            className="login-submit"
          >
            登录
          </Button>
        </Form>

        <div className="login-footer">v{settings.version}</div>
      </div>
    </div>
  )
}
