/**
 * 错误提示的注入点。
 *
 * API 层不直接 import antd 的 message：一是避免 antd 5 的静态方法拿不到
 * ConfigProvider 的主题上下文，二是不想让 api/ 依赖 UI 库。
 * App 启动时用 setErrorNotifier() 把 antd 的 message 实例注册进来。
 */

type Notifier = (text: string) => void

let notifier: Notifier = (text) => {
  // 还没注册（例如应用启动阶段就出错）时至少留个痕迹，不要静默
  console.error('[admin-v2]', text)
}

export function setErrorNotifier(fn: Notifier): void {
  notifier = fn
}

export function notifyError(text: string): void {
  notifier(text)
}
