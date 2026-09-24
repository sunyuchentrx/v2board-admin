import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { login as loginRequest, revokeSession } from '@/api/auth'
import {
  clearSession,
  loadSession,
  saveSession,
  sessionIdOf,
  subscribeSessionChange,
} from './session'

interface AuthContextValue {
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** 非管理员登录后台时抛这个，UI 层给出针对性提示 */
export class NotAdminError extends Error {
  constructor() {
    super('该账号不是管理员,无法登录后台')
    this.name = 'NotAdminError'
  }
}

/** 必须渲染在 QueryClientProvider 里面：退出时要清 react-query 缓存 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [isAuthenticated, setAuthenticated] = useState(
    () => loadSession() !== null,
  )

  // 上一次退出发出的撤销请求（已兜住失败，永远 resolve）
  const pendingRevoke = useRef<Promise<void> | null>(null)

  const signIn = useCallback(async (email: string, password: string) => {
    // 退出后马上又登录时，先等撤销请求落地再登录：后端 removeSession 和 login 里的
    // addSession 都是对 USER_SESSIONS:{uid} 先读再整体写回、不加锁，两者交错时
    // 撤销那一方会用旧列表覆盖掉刚加进去的新 session → 新登录的第一次请求就 403。
    // 正常情况撤销早已完成，这里等于没等；最坏等撤销请求的 5 秒超时（api/auth.ts）。
    if (pendingRevoke.current) await pendingRevoke.current
    const auth = await loginRequest(email, password)

    // 后端 login 接口对普通用户也会签发 auth_data，是 Admin 中间件在后续请求里
    // 才拒绝非管理员。前端提前拦一下，否则用户会「登录成功」然后每个页面都 403。
    if (!auth.is_admin) {
      throw new NotAdminError()
    }

    saveSession({ authData: auth.auth_data, isAdmin: true })
    setAuthenticated(true)
  }, [])

  const signOut = useCallback(() => {
    // 先把撤销请求发出去，再清本地（原因见 api/auth.ts 的 revokeSession）。
    // 凭证是显式传进去的，不依赖 localStorage，所以下面立刻 clearSession 不影响它。
    // 不 await：退出要立即生效，不能让管理员对着后台界面等网络；
    // 请求一旦发出，后端就会处理完，之后页面跳走 / 关掉都不影响。失败也忽略。
    const session = loadSession()
    const sessionId = session ? sessionIdOf(session.authData) : null
    if (session && sessionId) {
      pendingRevoke.current = revokeSession(session.authData, sessionId).catch(
        () => {},
      )
    }
    clearSession()
    setAuthenticated(false)
  }, [])

  // 退出后清空 react-query 内存缓存：里面还留着系统配置、支付密钥、用户列表等数据。
  // 放在 effect 里而不是 signOut 里：到这一步 RequireAuth 已经把后台页面卸载了，
  // 没有挂着的 useQuery。如果在页面还挂着时 clear，observer 可能立刻用空凭证重新请求
  // → 403 → 拦截器硬跳转登录页。
  useEffect(() => {
    if (!isAuthenticated) queryClient.clear()
  }, [isAuthenticated, queryClient])

  // 多标签页同步：别的标签页退出（或被 403 清掉凭证）时这里跟着退出，
  // 不再继续展示已加载的后台数据；别的标签页登录了，这里也跟着进入。
  // 这里不再调 revokeSession —— 撤销由发起退出的那个标签页负责，本页也已经拿不到凭证了。
  useEffect(
    () =>
      subscribeSessionChange(() => {
        setAuthenticated(loadSession() !== null)
      }),
    [],
  )

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated, signIn, signOut }),
    [isAuthenticated, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }
  return context
}
