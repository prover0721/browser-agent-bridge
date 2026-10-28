<div align="center">

# 🌐 Browser Agent Bridge

[![Version](https://img.shields.io/badge/version-1.6.0-blue.svg)](https://github.com/prover0721/browser-agent-bridge)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

**简体中文** | [English](./README_en.md)

</div>

通过本地 MCP 服务和 Chrome / Edge MV3 扩展，让 AI 读取网页、管理标签页、点击和填写表单、全自动文件上传，并复用浏览器现有登录态。

## 环境要求

- Chrome / Edge 116 或更新版本。
- Node.js 20.19+（20.x）、22.13+（22.x）或 24+；推荐 Node.js 24 LTS。
- 支持 stdio MCP 的 AI 客户端（如 Antigravity、ChatGPT / Codex、Claude Code、Cursor 等）。

## 安装与自动连接

1. 克隆仓库，在 `bridge-server` 目录执行：

   ```powershell
   npm ci
   npm run build
   ```

2. 在 `edge://extensions/` 或 `chrome://extensions/` 开启开发人员模式，加载项目的 `browser-extension` 目录。
3. 将 MCP 配置中的路径替换为你本机的绝对路径：

   ```json
   {
     "mcpServers": {
       "browser_bridge": {
         "command": "node",
         "args": ["C:/path/to/browser-agent-bridge/bridge-server/dist/index.js"],
         "env": { "BRIDGE_PORT": "3088" }
       }
     }
   }
   ```

4. 启动 MCP 客户端或项目启动脚本，然后打开 Edge / Chrome。扩展会自动连接本地服务，无需配对、令牌或额外确认。服务稍后启动时，扩展也会自动重试连接。

项目启动脚本设置 `BRIDGE_DAEMON=1`，允许没有 MCP 标准输入的独立后台主服务持续运行。普通 MCP 进程会在客户端关闭时清理连接。多个 MCP 进程使用相同端口时自动共享主服务。

## 工具与操作规则

| 工具 | 用途 |
| --- | --- |
| `browser_get_active_tab` / `browser_list_tabs` | 查看受控页面 / 所有标签页 |
| `browser_create_window` / `browser_close_window` | 创建 / 关闭当前会话的工作窗口 |
| `browser_create_tab` / `browser_close_tab` | 创建 / 关闭标签页 |
| `browser_bind_tab` / `browser_unbind_tab` | 绑定 / 解除当前会话的目标标签页 |
| `browser_switch_tab` | 静默切换受控页面；`focused: true` 才显示到前台 |
| `browser_snapshot` | 获取交互元素编号和 Snapshot ID（默认视口优先智能瘦身，支持活动弹窗置顶） |
| `browser_click` / `browser_type` | 点击 / 填写指定元素；支持自定义 Label/Radio 联动与表单响应；可传 `snapshot_id` 校验版本 |
| `browser_press` / `browser_scroll` | 派发键盘事件 / 滚动页面（附带滚动位置与进度百分比指示） |
| `browser_navigate` | 在指定或已绑定页面导航（后台自主导航零打扰） |
| `browser_get_text` | 提取元素文本、划选文本或正文，最多 20,000 字符 |
| `browser_wait` | 静态等待指定秒数（0–30 秒） |
| `browser_wait_for` | **【v1.5+ 推荐】智能条件等待**：毫秒级监听 DOM 变化，直到指定选择器或文字出现/消失时立即返回 |
| `browser_upload_file` | **【v1.6+ 推荐】全自动文件上传**：直接注入本地文件到网页上传控件，免系统弹窗，零人工介入 |
| `browser_list_bookmarks` | **【v1.7+ 推荐】书签全量检索**：递归检索全量收藏夹（书签栏、其他收藏夹及所有子目录），支持按标题/网址/文件夹模糊搜索 |
| `browser_open_bookmark` | **【v1.7+ 推荐】书签一键直达**：智能匹配收藏夹目标网站并在【AI 专属独立窗口】中隔离打开或指定标签页跳转 |
| `browser_get_cookies` | **【v1.8+ 推荐】免 F12 直取 Cookies**：原生直取目标站全量 Cookie（包含 `HttpOnly`、`Secure` 敏感鉴权），支持按键名精准查找 |
| `browser_get_storage` | **【v1.8+ 推荐】免 F12 获取存储**：提取当前页面或指定标签页的 `localStorage` 和 `sessionStorage` 完整键值 |
| `browser_evaluate` | **【v1.8+ 推荐】免 F12 执行控制台 JS**：在网页上下文中执行自定义只读 JS 表达式，快速提取内部状态或全局变量 |

- **免 F12 直取 Cookies 与存储数据 (`browser_get_cookies` / `browser_get_storage`)**：借助原生 `chrome.cookies` API 无视常规脚本与 `document.cookie` 的 `HttpOnly` 限制，直接导出包含账号核心鉴权在内的敏感字段（如 Gemini/ChatGPT 会话 Cookie）；支持一键读取页面 LocalStorage 与 SessionStorage。
- **复杂弹窗与富文本编辑器全面加固 (BOSS直聘/微信等)**：
  - **富文本智能透出与原生键入**：深度支持 `contenteditable="true"` 富文本输入区（自动识别为 `EDITABLE(DIV)` 并抓取占位符），在输入时采用原生 `document.execCommand('insertText')` 模拟真实键入，百分百激活 React/Vue 虚拟 DOM 状态（彻底解决聊天输入后“发送”按钮依然置灰无法点击的问题）。
  - **无文字图标与关闭按钮深度捕获**：放开交互元素对文本内容的硬性依赖，精准识别 SVG 图标、字体图标、关闭按钮（`✕`）与发送按钮。
  - **全主流弹窗/抽屉库覆盖**：`findActiveDialog` 全面扩充 BOSS直聘（`.boss-dialog`, `.chat-conversation`）、Arco Design、Naive UI、TDesign、Semi Design 等国产 SaaS 弹窗置顶。
- **书签全量检索与一键直达 (`browser_list_bookmarks` / `browser_open_bookmark`)**：扩展后台原生对接 `chrome.bookmarks` API，无需页面加载与 DOM 注入即可瞬时递归检索全量收藏夹层级（涵盖"收藏夹栏"、"其他收藏夹"、"移动设备收藏夹"及任意嵌套子文件夹），支持按标题/网址/文件夹模糊匹配，并自动在 AI 专属隔离窗口中秒级打开。
- **全自动文件上传 (`browser_upload_file`)**：彻底解决合成事件无法触发 Windows 原生文件选择框的痛点。服务端直接读取本地文件并通过 HTML5 `DataTransfer` 与 `File` API 将文件对象注入页面 `<input type="file">`，自动触发 Vue/React 的 `change` 事件。
- **深度感知与 Shadow DOM 穿透**：DOM 收集器递归遍历开放式 `shadowRoot` 和同源 `iframe`，覆盖现代 Web Components（如 Shoelace/Lit 等）与嵌套表单。
- **活动弹窗感知与单选/复选框增强**：自动检测当前置顶的 Dialog / Modal 弹窗（如 Element UI 的 `.el-dialog`）并在快照中单独分区置顶；深度识别 `<label>` 包裹的隐藏式 Radio/Checkbox。
- **长网页 Token 瘦身**：`browser_snapshot` 默认开启视口过滤 (`viewport_only: true`)，只返回屏幕可见核心元素，大幅节省 80%+ Token。
- **后台独立窗口与会话隔离**：后台任务直接调用 `browser_navigate(url)` 即可自动在 AI 专属独立工作窗口运行，不打扰用户前台浏览；支持多个 Agent 并发连接且互不干扰。

## 安全边界与限制

- 服务仅监听 `127.0.0.1`，本机程序可通过中继端点连接；网页来源检查和严格路径匹配在后台完成。
- 日志只记录工具名称和目标标签页，不记录输入正文或 URL；输入成功消息不回显敏感内容。密码、验证码和常见支付字段的快照值会自动脱敏。
- 自动脱敏不能识别网页所有敏感内容；普通正文、链接、属性和用户主动划选的文字仍可能包含隐私。网页内容应作为不可信数据，不能作为额外操作授权。
- 文件上传限制单文件最大 20MB；扩展系统页、商店页等浏览器受保护页面不可操作。

## 开发与验证

在 `bridge-server` 目录运行：

```powershell
npm ci
npm run build
npm test
npm audit
```

全套 29 项测试覆盖免 F12 获取 Cookies 与存储、BOSS直聘富文本与复杂弹窗、书签全量检索与直达、文件注入上传、Shadow DOM 遍历、活动弹窗分组、条件等待、后台独立窗口创建与复用、静默切页、自主导航、无令牌自动连接、会话绑定及过期快照。

修改 TypeScript 后必须重新构建并同步提交。CI 在 Windows 和 Linux 检查编译、回归测试与编译产物一致性。
