# UI 设计规范

> 2026-09 UI 美化时定下的规范。改页面前先读这份，保证全站风格一致。

目标：现代、干净、对齐严格的 SaaS 管理后台风格（参考 Linear / Vercel / Stripe Dashboard 的克制感），浅色与深色都要好看。
技术栈保持 antd 5 + @ant-design/pro-table（不要换框架、不要引入 Tailwind）。

## 已经就绪的基础设施（直接用，不要重复造）
- `src/theme/index.tsx`：全站 token（主色 #4f46e5、圆角 8/12、controlHeight 34、Inter 字体）、暗色模式、静态方法（Modal.confirm/message）也吃主题。
  - 需要颜色时：`const { token } = theme.useToken()`，或 CSS 里用 `var(--va-color-xxx)`（antd cssVar，前缀 va，例如 `--va-color-primary`、`--va-color-text-secondary`、`--va-color-border-secondary`、`--va-color-fill-alter`、`--va-color-bg-container`、`--va-border-radius-lg`、`--va-font-family-code`）。
  - **禁止硬编码颜色**（#fff、#fafafa、#f0f0f0、#999、rgba 黑白等）—— 暗色模式会变成白块。已有的硬编码要替换成 token。唯一例外：图表系列色可以用固定调色板（见下）。
- `src/styles/global.css`：卡片阴影、ProTable 外观、Modal 头/尾分隔线、表头、工具类 `.mono` `.muted` `.code-block`。
- `src/layout/AdminLayout.tsx`：顶栏面包屑 + 内容区顶部已经渲染 **页面大标题 + 描述**（来自 navigation.ts）。页面本身**不要再渲染一级标题**。
- `src/components/FilterBar.tsx`：已重做的过滤条（紧凑组合输入）。
- `src/components/FormSection.tsx`：表单分组小节 `<FormSection title="订阅" description="..." first>...</FormSection>`，替代 `<Divider orientation="left" plain>` 当小标题。
- `src/components/SettingSwitch.tsx`：开关行 `<SettingSwitch name="banned" title="封禁" description="封禁会踢掉全部会话" />`（它本身就是一个 Form.Item，valuePropName=checked 已处理；可额外传 rules/dependencies 等 Form.Item 属性，`onChange` 回调可选）。用它替代「Form.Item label + Switch」放进栅格列的写法。
- `src/components/RowActions.tsx`：表格操作列 `<RowActions actions={[{key,label,icon,onClick,danger?,iconOnly?,divider?}]} inline={2} />`，超出的动作自动收进「更多」菜单。

## 页面结构
- 页面根：直接返回内容（布局已提供标题）。多个区块之间用 `<Flex vertical gap={16}>` 或 `Space direction="vertical" size={16} style={{width:'100%'}}`。
- ProTable：
  - `headerTitle` 改成列表级小标题（如「全部用户」「订单列表」），可以带一个次要说明（`Typography.Text type="secondary"` 12px）。不要和页面标题重复。
  - 工具栏按钮顺序：次要按钮（刷新/导出）→ 批量/下拉 → 主按钮（新建，type=primary）放最右。
  - `options` 保留 setting/fullScreen 即可；`cardBordered` 不要开（global.css 已给卡片描边）。
  - 操作列用 `RowActions`，宽度要能容纳，`fixed: 'right'`。删除等危险动作放进「更多」或 iconOnly+danger。
  - 列宽：给每一列合理的 `width` 或 `ellipsis: true`，保证 1440px 宽屏下不出现文字被固定列遮挡；数值列 `align: 'right'`；ID 列窄（70-80）。
  - 状态用 `Tag bordered={false} color=...`（success/processing/warning/error/default），同一语义全站同色。
- 普通 Card：`<Card title=... extra=...>`，不要 `size="small"` 混用；卡片内部间距交给 antd。

## 表单对齐（本次重点——用户吐槽「输入框、下拉框错位不整齐」）
- 统一 `layout="vertical"`，`requiredMark` 保持默认或 `optional`，不要混用。
- 栅格：`<Row gutter={16}>`，列宽用响应式 `xs={24} md={12}` / `md={8}` / `md={6}`，**同一行的列应该放同类控件**（输入框/下拉/日期/数字），开关一律用 SettingSwitch（可以两个/三个一行，放在它们自己的 Row 里）。
- **同一行里不要只有部分项带 `extra`**（会把那一项撑高、下一行错位）。说明文字改用 Form.Item 的 `tooltip` 属性（label 旁的问号），或全行都有 extra，或整行下方放一条 `Typography.Text type="secondary"`。
- label 里不要塞会改变高度的元素（Tag 用 `bordered={false}` 且 size 小；或改成 tooltip）。
- 所有 InputNumber / Select / DatePicker / TimePicker / Cascader 必须 `style={{ width: '100%' }}`（或 className 等效），不能出现固定 px 宽度导致同列宽窄不一；带单位的数值用 `addonAfter="GB"` / `suffix`，不要把单位写在 label 里又写在 addon 里。
- 金额输入：`addonBefore="¥"` 或 `prefix="¥"`，`precision={2}`。
- TextArea 用 `autoSize={{ minRows: 3, maxRows: 10 }}`；代码/JSON 类用 `className="mono"`。
- 表单分组用 FormSection，第一组加 `first`。
- Modal：宽度只用 520 / 640 / 760 / 960 四档；`destroyOnClose` 已废弃，改 `destroyOnHidden`；`maskClosable={false}` 用于编辑类弹窗；长表单弹窗给 body 设 `styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}`。Modal 的 okText/cancelText 用中文动词（保存/创建/取消）。
- Drawer：`width={560}` 或 720，footer 放操作按钮右对齐。

## 视觉细节
- 数字：`className="tabular-nums"`；金额「¥1,234.56」统一格式（用 src/lib/format.ts 已有函数）。
- 空值显示「—」并 `type="secondary"`。
- 可复制的 token/链接：`Typography.Text copyable className="mono"`，长内容 `ellipsis`。
- 图标：@ant-design/icons 的 Outlined 系列，按钮图标与文字搭配一致。
- 图表（recharts）：系列色用调色板 `['#4f46e5','#06b6d4','#f59e0b','#10b981','#ef4444','#8b5cf6']`，网格线/坐标轴文字/Tooltip 背景用 token（暗色可读），`strokeDasharray="3 3"` 的浅网格，圆角柱。
- 统计卡片：小号 secondary 标题 + 大号数字（26px、600、tabular-nums）+ 次要对比信息（涨跌用 success/error 色 + 箭头图标）；图标放在带主色淡背景的圆角方块里。
- 响应式：375px 宽时不出现横向滚动（表格除外，表格自己横向滚动）；工具栏换行整齐。

## 不要做的事
- 不要改业务逻辑、接口调用、payload 结构、校验规则（除非是为了对齐而把 extra 挪成 tooltip 这类纯展示变动）。安全修复刚刚落地，**保留所有逻辑与注释**（尤其是解释后端坑的中文注释）。
- 不要引入新依赖。
- 页面级改动不要顺手改共享层（src/theme、src/styles/global.css、src/layout/*、src/components/*）；共享层要改就单独改、全站回归截图。
- 不要用 `!important`，除非是覆盖 antd 内联样式且无其他办法。页面级 CSS 放同目录 `XxxPage.css` 并用页面前缀类名（如 `.user-page-...`），避免全局污染。

## 验证（必须做）
- `npm run typecheck` 必须干净。
- 起 mock 后端和 dev server（见 [dev/README.md](../dev/README.md)），用截图工具看效果：
  `cd dev/shot && node shoot.mjs out/<名字> /user "/user|编辑"`
  （`路由|按钮文字` 表示打开页面后点击第一个包含该文字的按钮再截图；`THEME=dark` 截暗色；`W=390 H=844` 截手机；`FULL=1` 整页）。
- 需要更复杂交互（打开第 N 行的编辑、切换 Tab、打开下拉）时，参考 shoot.mjs 自己写 puppeteer 脚本：登录态写 localStorage `v2board_admin_v2_auth` = `{"authData":"mock-jwt","isAdmin":true}`，暗色写 `v2board_admin_v2_theme` = `dark`。
- 逐张检查：对齐、间距、截断、暗色可读性、控制台报错。
