import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Tooltip,
  Typography,
  theme,
  type MenuProps,
} from 'antd'
import {
  AppstoreOutlined,
  BarChartOutlined,
  BookOutlined,
  CloudServerOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  FundProjectionScreenOutlined,
  GiftOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoonOutlined,
  NotificationOutlined,
  SettingOutlined,
  ShoppingOutlined,
  SkinOutlined,
  SunOutlined,
  TagOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/auth/AuthContext'
import { settings } from '@/settings'
import { SIDER_BG, useColorMode } from '@/theme'
import { NAV_GROUPS, NAV_ITEMS } from './navigation'
import './layout.css'

const ICONS: Record<string, ReactNode> = {
  dashboard: <DashboardOutlined />,
  team: <TeamOutlined />,
  shopping: <ShoppingOutlined />,
  appstore: <AppstoreOutlined />,
  tag: <TagOutlined />,
  gift: <GiftOutlined />,
  notification: <NotificationOutlined />,
  book: <BookOutlined />,
  cloud: <CloudServerOutlined />,
  'bar-chart': <BarChartOutlined />,
  setting: <SettingOutlined />,
  message: <MessageOutlined />,
  'credit-card': <CreditCardOutlined />,
  skin: <SkinOutlined />,
  monitor: <FundProjectionScreenOutlined />,
}

const SIDER_WIDTH = 232
const SIDER_COLLAPSED = 72
const COLLAPSE_KEY = 'v2board_admin_v2_sider_collapsed'

function Brand({ collapsed, dark }: { collapsed: boolean; dark: boolean }) {
  const initial = (settings.title || 'V').trim().charAt(0).toUpperCase()
  return (
    <div className={`app-brand${collapsed ? ' is-collapsed' : ''}${dark ? ' is-dark' : ''}`}>
      {settings.logo ? (
        <img className="app-brand-logo" src={settings.logo} alt="" />
      ) : (
        <span className="app-brand-mark">{initial}</span>
      )}
      {!collapsed && (
        <div className="app-brand-text">
          <span className="app-brand-title">{settings.title}</span>
          <span className="app-brand-sub">管理后台</span>
        </div>
      )}
    </div>
  )
}

function SideMenu({
  collapsed,
  dark,
  onNavigate,
}: {
  collapsed: boolean
  dark: boolean
  onNavigate?: () => void
}) {
  const location = useLocation()

  const items = useMemo<MenuProps['items']>(
    () =>
      NAV_GROUPS.map((group) => ({
        type: 'group' as const,
        key: `g-${group.key}`,
        label: collapsed ? null : group.label,
        children: NAV_ITEMS.filter((item) => item.group === group.key).map((item) => ({
          key: item.key,
          icon: ICONS[item.icon],
          label: (
            <Link to={item.key} onClick={onNavigate}>
              {item.label}
            </Link>
          ),
        })),
      })),
    [collapsed, onNavigate],
  )

  return (
    <Menu
      className="app-menu"
      mode="inline"
      theme={dark ? 'dark' : 'light'}
      inlineCollapsed={collapsed}
      selectedKeys={[location.pathname]}
      items={items}
    />
  )
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const screens = Grid.useBreakpoint()
  const isMobile = screens.lg === false
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { signOut } = useAuth()
  const { mode, toggle } = useColorMode()
  const { token } = theme.useToken()
  const location = useLocation()

  // 侧边栏配色：后台「侧边栏主题」配置为 light 时用浅色，否则深色
  const darkSider = settings.theme.sidebar !== 'light' || mode === 'dark'

  const current = NAV_ITEMS.find((item) => item.key === location.pathname)
  const group = NAV_GROUPS.find((g) => g.key === current?.group)

  useEffect(() => {
    document.title = current ? `${current.label} · ${settings.title}` : settings.title
  }, [current])

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  function toggleCollapsed() {
    if (isMobile) {
      setDrawerOpen(true)
      return
    }
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // 忽略
      }
      return !c
    })
  }

  const siderStyle = {
    background: darkSider ? SIDER_BG : token.colorBgContainer,
    borderInlineEnd: darkSider ? 'none' : `1px solid ${token.colorBorderSecondary}`,
  }

  const siderContent = (isCollapsed: boolean) => (
    <div className="app-sider-inner">
      <Brand collapsed={isCollapsed} dark={darkSider} />
      <div className="app-sider-scroll">
        <SideMenu
          collapsed={isCollapsed}
          dark={darkSider}
          onNavigate={isMobile ? () => setDrawerOpen(false) : undefined}
        />
      </div>
      {!isCollapsed && (
        <div className={`app-sider-footer${darkSider ? ' is-dark' : ''}`}>
          v{settings.version}
        </div>
      )}
    </div>
  )

  return (
    <Layout className="app-shell">
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={SIDER_WIDTH}
          closable={false}
          styles={{ body: { padding: 0, ...siderStyle } }}
        >
          {siderContent(false)}
        </Drawer>
      ) : (
        <Layout.Sider
          className="app-sider"
          collapsible
          collapsed={collapsed}
          trigger={null}
          width={SIDER_WIDTH}
          collapsedWidth={SIDER_COLLAPSED}
          style={siderStyle}
        >
          {siderContent(collapsed)}
        </Layout.Sider>
      )}

      <Layout className="app-main">
        <Layout.Header className="app-header">
          <div className="app-header-left">
            <Button
              type="text"
              className="app-header-icon"
              aria-label="切换侧边栏"
              icon={
                isMobile ? (
                  <MenuOutlined />
                ) : collapsed ? (
                  <MenuUnfoldOutlined />
                ) : (
                  <MenuFoldOutlined />
                )
              }
              onClick={toggleCollapsed}
            />
            <nav className="app-breadcrumb" aria-label="当前位置">
              {group && (
                <>
                  <span className="app-breadcrumb-group">{group.label}</span>
                  <span className="app-breadcrumb-sep">/</span>
                </>
              )}
              <span className="app-breadcrumb-page">{current?.label ?? settings.title}</span>
            </nav>
          </div>

          <div className="app-header-right">
            <Tooltip title={mode === 'dark' ? '切换到浅色' : '切换到深色'}>
              <Button
                type="text"
                className="app-header-icon"
                aria-label="切换深浅色"
                icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                onClick={toggle}
              />
            </Tooltip>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  {
                    key: 'version',
                    disabled: true,
                    label: <span className="muted">版本 v{settings.version}</span>,
                  },
                  { type: 'divider' },
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    danger: true,
                    label: '退出登录',
                    onClick: signOut,
                  },
                ],
              }}
            >
              <button type="button" className="app-user">
                <Avatar size={30} icon={<UserOutlined />} className="app-user-avatar" />
                {!isMobile && <span className="app-user-name">管理员</span>}
              </button>
            </Dropdown>
          </div>
        </Layout.Header>

        <Layout.Content className="app-content">
          {current && (
            <div className="app-page-head">
              <Typography.Title level={3} className="app-page-title">
                {current.label}
              </Typography.Title>
              {current.description && (
                <Typography.Text type="secondary" className="app-page-desc">
                  {current.description}
                </Typography.Text>
              )}
            </div>
          )}
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
