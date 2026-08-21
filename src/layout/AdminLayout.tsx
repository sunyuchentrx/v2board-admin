import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button, Layout, Menu, Typography } from 'antd'
import {
  AppstoreOutlined,
  BarChartOutlined,
  BookOutlined,
  CloudOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  GiftOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  NotificationOutlined,
  SettingOutlined,
  ShoppingOutlined,
  SkinOutlined,
  TagOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/auth/AuthContext'
import { settings } from '@/settings'
import { NAV_ITEMS } from './navigation'

const ICONS: Record<string, ReactNode> = {
  dashboard: <DashboardOutlined />,
  team: <TeamOutlined />,
  shopping: <ShoppingOutlined />,
  appstore: <AppstoreOutlined />,
  tag: <TagOutlined />,
  gift: <GiftOutlined />,
  notification: <NotificationOutlined />,
  book: <BookOutlined />,
  cloud: <CloudOutlined />,
  'bar-chart': <BarChartOutlined />,
  setting: <SettingOutlined />,
  message: <MessageOutlined />,
  'credit-card': <CreditCardOutlined />,
  skin: <SkinOutlined />,
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const { signOut } = useAuth()
  const location = useLocation()

  const menuItems = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        key: item.key,
        icon: ICONS[item.icon],
        label: <Link to={item.key}>{item.label}</Link>,
      })),
    [],
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        theme={settings.theme.sidebar === 'dark' ? 'dark' : 'light'}
        width={220}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 12px',
            overflow: 'hidden',
          }}
        >
          <Typography.Text strong ellipsis>
            {collapsed ? 'V2' : settings.title}
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          theme={settings.theme.sidebar === 'dark' ? 'dark' : 'light'}
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Layout.Sider>

      <Layout>
        <Layout.Header
          style={{
            background: '#fff',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              v{settings.version}
            </Typography.Text>
            <Button icon={<LogoutOutlined />} onClick={signOut}>
              退出
            </Button>
          </div>
        </Layout.Header>

        <Layout.Content style={{ padding: 16 }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  )
}
