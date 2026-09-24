/**
 * 运行期配置。生产环境来自 blade 注入的 window.settings；
 * 开发环境（vite dev）没有 blade，回落到 .env.development.local 里的 VITE_* 变量。
 */

const injected = window.settings

/**
 * secure_path 同时用于两处，任一处硬编码都会在换 secure_path 后静默失效：
 *   - 界面路由：/{secure_path}/v2
 *   - 管理 API 前缀：/api/v1/{secure_path}/...
 * 所以只能从这里取。
 */
export const securePath: string =
  injected?.secure_path ||
  // 只在 dev 读 VITE_SECURE_PATH：import.meta.env.DEV 在生产构建里被静态替换成 false，
  // 整个分支连同字面量一起被摇掉。否则 .env / .env.local 里的真实 secure_path 会被
  // 打进公开可访问的 app.js，任何人都能 grep 出后台秘密路径。
  (import.meta.env.DEV ? import.meta.env.VITE_SECURE_PATH : '') ||
  ''

if (!securePath) {
  // 没有 secure_path 意味着所有管理接口都会 404，早失败比让用户对着空白页猜好。
  console.error(
    '[admin-v2] secure_path 缺失：生产环境请检查 blade 是否注入 window.settings，' +
      '开发环境请在 .env.development.local 里设置 VITE_SECURE_PATH。',
  )
}

export const settings = {
  title: injected?.title || 'V2Board',
  version: injected?.version || 'dev',
  logo: injected?.logo || '',
  backgroundUrl: injected?.background_url || '',
  theme: {
    sidebar: injected?.theme?.sidebar || 'light',
    header: injected?.theme?.header || 'dark',
    color: injected?.theme?.color || 'default',
  },
  securePath,
}

/** 管理接口基址。注意 secure_path 既是界面路径也是 API 前缀。 */
export const adminApiBase = `/api/v1/${securePath}`

/** 免鉴权接口基址（登录走这里，不带 secure_path） */
export const passportApiBase = '/api/v1/passport'

/** 界面路由基址，供 react-router 的 basename 使用 */
export const uiBasePath = `/${securePath}/v2`
