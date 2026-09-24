# V2Board Admin

一个用现代技术栈重写的 **V2Board 管理后台前端**，对接 V2Board 现有的
`/api/v1/{secure_path}/*` 管理接口，**后端零改动**。

V2Board 原版的管理后台只以编译产物形式分发（约 11 MB 的 UmiJS bundle，无
sourcemap，没有公开的前端源码），无法二次开发。本项目照着后端接口重新实现了一份
完全开放、可维护的源码。

> 🚧 安全修复 + UI 美化进行中，方案与进度见 [docs/PROGRESS.md](docs/PROGRESS.md)，UI 规范见 [docs/UI-GUIDE.md](docs/UI-GUIDE.md)，本地联调工具见 [dev/README.md](dev/README.md)。

## 特性

- **Vite + React 18 + TypeScript + Ant Design 5**，源码完整
- 构建产物约 245 KB（入口）+ 按库分包，对比原版 11 MB
- 覆盖后端全部 **109 个可用管理接口**（用户、订单、套餐、节点、优惠券、
  礼品卡、工单、支付、统计、系统配置等）
- 节点管理用 **schema 驱动**渲染 8 种协议（Shadowsocks / Trojan / VMess /
  VLESS / TUIC / Hysteria / AnyTLS / V2node）的表单
- 与原后台**可并存**：挂在独立路由，原后台不受影响，可随时切回

## 环境要求

- Node 18+
- 一个可访问的 V2Board 后端（用于开发联调 / 生产对接）

## 快速开始

```bash
npm install

# 开发：连接一个真实后端
cp .env.development .env.development.local
# 编辑 .env.development.local，填入你的 secure_path 和后端地址
npm run dev
```

打开 `http://localhost:5173/{secure_path}/v2/login`。

`.env.development.local` 需要两个变量（这个文件只在 `vite dev` 时加载，`npm run build` 不读）：

```
# 后台的秘密路径（V2Board 后台配置里的 secure_path）
VITE_SECURE_PATH=你的_secure_path
# 后端地址；开发期 /api 会被代理到这里
VITE_API_TARGET=https://你的面板域名
```

## 构建

```bash
npm run build      # 产物输出到 dist/
```

## 部署（挂到 V2Board 后端）

本前端是纯静态 SPA，部署就是「把 `dist/` 交给一个 HTML 壳，让后端在某个路由返回它」。

1. **放置产物**：把 `dist/` 里的文件放到后端能作为静态资源访问的目录，
   例如 `public/assets/admin-v2/`。
2. **提供 HTML 壳**：让后端在你选的路由（例如 `/{secure_path}/v2/{any?}`，
   `{any?}` 通配是必需的——SPA 深链接刷新要靠它）返回一个 HTML，其中：
   - 引入构建出的入口脚本，**必须带 `type="module"`**（产物是 ES module，
     用普通 `<script>` 会因顶层 `export` 报错白屏）
   - 注入一个 `window.settings` 对象，至少包含 `secure_path`：

     ```html
     <script>
       window.settings = {
         title: 'V2Board',
         secure_path: '{{ 后端注入的 secure_path }}',
         theme: { sidebar: 'light', header: 'dark', color: 'default' },
         version: '{{ 版本号 }}',
         logo: '', background_url: ''
       }
     </script>
     <div id="root"></div>
     <script type="module" src="/assets/admin-v2/app.js?v={{ 缓存版本 }}"></script>
     ```

   仓库根目录的 `index.html` 是开发用的壳，可作为编写这个模板的参考。

3. **缓存刷新**：入口脚本的 `?v=` 参数建议用产物文件的 mtime 或内容哈希，
   不要用一个不随构建变化的固定版本号，否则更新前端后用户会一直命中旧缓存。

`window.settings.secure_path` 同时决定界面路由前缀和 API 前缀，
所以它只能在运行时注入，不能写死在代码里。

## 对接后端时需要知道的约定

这些是 V2Board 后端的既有行为，本前端已按它们实现。二次开发时值得留意：

- **鉴权头放裸 JWT，不加 `Bearer ` 前缀** —— 后端把 header 原值直接解码，
  多了前缀会静默 403。
- **HTTP 500 不一定是故障** —— 后端用 500 + `{message}` 返回业务错误
  （如密码错误）。只有 **403** 才表示未登录 / 登录过期。UI 要展示 `message`。
- **列表分页是 Ant Design Pro 约定**（`current` / `pageSize` / `sort` /
  `sort_type`），响应 `{data, total}`。`pageSize < 10` 会被后端强制成 10。
  例外：系统日志接口的分页大小参数是 `page_size`（下划线）。
- **单位**：用户流量是字节、套餐流量是 GB、金额一律是分、时间是 unix 秒。
- 部分接口有历史遗留的行为差异（`show` 有的是取反有的是设值、若干路由已废弃等），
  详见 `src/api/endpoints.ts` 的注释——那里逐条标注了每个接口的坑。

## 目录结构

```
src/
  api/          接口清单、HTTP 客户端、各业务域的 typed API
  auth/         会话存储与鉴权上下文
  components/   通用组件（过滤条等）
  layout/       侧边栏与导航
  lib/          单位换算 / 下载 / 提示
  pages/        各功能页面
  settings.ts   运行时配置（读 window.settings）
```

## 许可

见 [LICENSE](LICENSE)。
