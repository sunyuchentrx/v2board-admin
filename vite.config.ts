import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 构建产物输出到 dist/。
 *
 * 部署时把 dist/ 交给后端作为静态资源，并由后端在某个路由返回一个引用
 * dist/app.js 的 HTML 壳（见 README「部署」一节）。
 *
 * 两个刻意的选择，都是为了让后端那个 HTML 壳能静态引用产物：
 *   - 入口固定命名 app.js（不带内容 hash）——壳可以写死 <script src=".../app.js">，
 *     缓存刷新交给 ?v= 查询参数（用 mtime / 版本号）。
 *   - 产物是 ES module，壳里必须用 <script type="module"> 加载。
 *
 * `base` 默认 '/'。如果产物不是挂在站点根，而是某个子路径
 * （例如 /assets/admin-v2/），构建时用 `vite build --base=/assets/admin-v2/` 指定。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        // fileURLToPath 而不是 URL.pathname：后者在 Windows / 中文路径下是 /C:/%E9%A1%B9... 形式，解析失败
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      cssCodeSplit: false,
      rollupOptions: {
        // 以 tsx 为入口，不产出 index.html —— 生产用的 HTML 壳由后端提供
        // （构建出的 index.html 带的是 dev 用的假 window.settings，留着会误导）。
        // dev 模式仍然用根目录的 index.html，本配置只作用于 build。
        input: 'src/main.tsx',
        output: {
          format: 'es',
          // 分包：把不常变的第三方库拆出去，改业务代码时只需重下入口包
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            antd: ['antd', '@ant-design/icons'],
            protable: ['@ant-design/pro-table'],
            charts: ['recharts'],
          },
          entryFileNames: 'app.js',
          // chunk 带 hash：它们只被 app.js 引用，app.js 的 ?v= 刷新不到固定名的 chunk
          chunkFileNames: 'chunk-[name]-[hash].js',
          assetFileNames: (info) => {
            const name =
              (info as { names?: string[] }).names?.[0] ??
              (info as { name?: string }).name ??
              ''
            return name.endsWith('.css')
              ? 'app.css'
              : 'static/[name]-[hash][extname]'
          },
        },
      },
    },
    server: {
      port: 5173,
      // 开发期把 /api 代理到你的后端；用 .env.development.local 的 VITE_API_TARGET 覆盖
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
