import { useEffect } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { App as AntdApp } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/auth/AuthContext'
import { setErrorNotifier } from '@/lib/notify'
import { uiBasePath } from '@/settings'
import { MESSAGE_CONFIG, ThemeProvider } from '@/theme'
import AdminLayout from '@/layout/AdminLayout'
import { NAV_ITEMS } from '@/layout/navigation'
import Login from '@/pages/Login'
import Placeholder from '@/pages/Placeholder'
import UserList from '@/pages/user/UserList'
import OrderList from '@/pages/order/OrderList'
import PlanList from '@/pages/plan/PlanList'
import CouponList from '@/pages/promo/CouponList'
import GiftcardList from '@/pages/promo/GiftcardList'
import NoticeList from '@/pages/content/NoticeList'
import KnowledgeList from '@/pages/content/KnowledgeList'
import ServerPage from '@/pages/server/NodeList'
import Dashboard from '@/pages/stat/Dashboard'
import ConfigPage from '@/pages/config/ConfigPage'
import TicketList from '@/pages/ops/TicketList'
import PaymentList from '@/pages/ops/PaymentList'
import ThemePage from '@/pages/ops/ThemePage'
import SystemStatus from '@/pages/ops/SystemStatus'

/** 已实现的页面。navigation.ts 里 done:true 的项在这里必须有对应组件。 */
const PAGES: Record<string, React.ComponentType> = {
  '/user': UserList,
  '/order': OrderList,
  '/plan': PlanList,
  '/coupon': CouponList,
  '/giftcard': GiftcardList,
  '/notice': NoticeList,
  '/knowledge': KnowledgeList,
  '/server': ServerPage,
  '/': Dashboard,
  '/stat': Dashboard,
  '/config': ConfigPage,
  '/ticket': TicketList,
  '/payment': PaymentList,
  '/theme': ThemePage,
  '/system': SystemStatus,
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // 403 重试没有意义，会刷屏
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

/** 把 antd 的 message 实例注册进 api 层，让接口错误能弹出来 */
function NotifierBridge() {
  const { message } = AntdApp.useApp()
  useEffect(() => {
    setErrorNotifier((text) => message.error(text))
  }, [message])
  return null
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

function LoginRoute() {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Navigate to="/" replace /> : <Login />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      {NAV_ITEMS.map((item) => {
        const Page = PAGES[item.key]
        return (
          <Route
            key={item.key}
            path={item.key}
            element={
              <RequireAuth>
                <AdminLayout>
                  {Page ? <Page /> : <Placeholder item={item} />}
                </AdminLayout>
              </RequireAuth>
            }
          />
        )
      })}
      {/* 未匹配的路径回首页，避免部署后深链接白屏 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AntdApp message={MESSAGE_CONFIG}>
        <NotifierBridge />
        <QueryClientProvider client={queryClient}>
          {/*
            basename 用 /{secure_path}/v2：
            新后台挂在旧后台旁边，两者互不影响（计划里的「新旧并存」红线）。
          */}
          <BrowserRouter basename={uiBasePath}>
            {/* AuthProvider 必须在 QueryClientProvider 里面：退出登录时要清空 queryClient 缓存 */}
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntdApp>
    </ThemeProvider>
  )
}
