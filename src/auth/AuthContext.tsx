import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { login as loginRequest } from '@/api/auth'
import { clearSession, loadSession, saveSession } from './session'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setAuthenticated] = useState(
    () => loadSession() !== null,
  )

  const signIn = useCallback(async (email: string, password: string) => {
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
    clearSession()
    setAuthenticated(false)
  }, [])

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
