# 本地联调工具

不连真实后端也能把整个后台跑起来、截图验收。

## mock 后端 `dev/mock/server.mjs`

零依赖（只用 `node:http`），实现了 `src/api/endpoints.ts` 里全部 114 个管理接口，数据全是假的（域名用 `.example` 保留域名）。

```bash
npm run mock                      # 监听 127.0.0.1:18080
MOCK_DELAY=300 npm run mock       # 每个请求延迟 300ms，看 loading 态
MOCK_STRICT=1 npm run mock        # 个别字段按真实后端的形状返回（见文件头注释）
node dev/mock/smoke.mjs           # 冒烟测试（mock 运行中执行）
```

`GET /__mock/reset` 把内存数据恢复到初始状态。任意邮箱 + 任意密码都能登录。

配合前端：新建 `.env.development.local`（已被 .gitignore 忽略）：

```
VITE_SECURE_PATH=admin
VITE_API_TARGET=http://127.0.0.1:18080
```

然后 `npm run dev`，打开 http://localhost:5173/admin/v2 。

## 截图工具 `dev/shot/`

```bash
cd dev/shot && npm install        # 只装 puppeteer-core，用本机 Chrome
node shoot.mjs out/demo /user "/user|编辑"      # 「路由|按钮文字」= 打开后点击该按钮再截
THEME=dark node shoot.mjs out/demo /user        # 暗色
W=390 H=844 node shoot.mjs out/demo /user       # 手机宽度
node probe.mjs /user some-snippet.js            # 在已登录页面里执行一段 JS 并打印结果
```

- Chrome 路径写死为 `C:/Program Files/Google/Chrome/Application/chrome.exe`，其他系统改 `shoot.mjs` 里的 `executablePath`。
- 登录态通过 `localStorage.v2board_admin_v2_auth` 注入，不走登录页。
- 在 Git Bash 里传 `/user` 这类参数要加 `MSYS_NO_PATHCONV=1`，否则会被改写成 Windows 路径。

### 重新生成 README 截图

```bash
npm run mock                                   # 先起 mock 后端
npm run dev                                    # 或者用生产构建按 README「部署」挂起来
cd dev/shot && node gallery.mjs                # 输出到 docs/screenshots/*.webp
BASE=http://127.0.0.1:5173/admin/v2 node gallery.mjs   # 指定后台地址
ONLY=users,user-edit node gallery.mjs          # 只重拍其中几张
```

截图清单在 `gallery.mjs` 的 `SHOTS` 里，名字和 README 里引用的文件名一一对应。截图前可以请求一次
`http://127.0.0.1:18080/__mock/reset`，让 mock 数据回到初始状态。
