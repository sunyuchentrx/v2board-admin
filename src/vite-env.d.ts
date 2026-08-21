/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 开发期 API 代理目标，例如 http://127.0.0.1:6600 */
  readonly VITE_API_TARGET?: string
  /** 开发期 secure_path，生产环境由 blade 注入 window.settings，不用这个 */
  readonly VITE_SECURE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * resources/views/admin-v2.blade.php 注入的全局配置。
 * 注意：blade 是把值插在引号里的，所以全部是字符串（含 version）。
 */
interface V2BoardSettings {
  title: string
  theme: {
    sidebar: string
    header: string
    color: string
  }
  version: string
  background_url: string
  logo: string
  /** 管理后台的秘密路径，同时是界面路由和 API 前缀 */
  secure_path: string
}

interface Window {
  settings?: V2BoardSettings
}
