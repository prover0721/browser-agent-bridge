# Browser Agent Bridge 1.5.0

通过本地 MCP 服务和 Chrome / Edge MV3 扩展，让 AI 读取网页、管理标签页、点击和填写表单，并复用浏览器现有登录态。

## 环境要求

- Chrome / Edge 116 或更新版本。
- Node.js 20.19+（20.x）、22.13+（22.x）或 24+；推荐 Node.js 24 LTS。
- 支持 stdio MCP 的 AI 客户端。

## 安装与配对

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

4. 启动 MCP 客户端或项目启动脚本。服务首次启动时自动生成配对令牌：
   - Windows：`%USERPROFILE%\.browser-agent-bridge\token-3088`
   - macOS / Linux：`~/.browser-agent-bridge/token-3088`
5. 用本地文本编辑器打开该文件，将其中的 64 位令牌填入扩展侧栏“配对令牌”，点击“重新连接”。不要把令牌提交到 Git 或发送给其他人。

项目启动脚本设置 `BRIDGE_DAEMON=1`，允许没有 MCP 标准输入的独立后台主服务持续运行。普通 MCP 进程会在客户端关闭时清理连接。多个 MCP 进程使用相同端口时自动共享主服务；默认从同一用户目录读取同一令牌。也可通过 `BRIDGE_TOKEN` 指定 64 位十六进制令牌，此时扩展和所有 MCP 进程必须配置相同值。

**从 1.4 升级：**先停止旧桥接服务，重新安装依赖并构建，再重载扩展、重启 MCP 客户端并完成上述配对。旧协议连接不再被接受。端口被旧版本服务占用时，新服务无法通过认证，请先关闭旧服务。

## 工具与操作规则

| 工具 | 用途 |
| --- | --- |
| `browser_get_active_tab` / `browser_list_tabs` | 查看受控页面 / 所有标签页 |
| `browser_create_window` / `browser_close_window` | 创建 / 关闭当前会话的工作窗口 |
| `browser_create_tab` / `browser_close_tab` | 创建 / 关闭标签页 |
| `browser_bind_tab` / `browser_unbind_tab` | 绑定 / 解除当前会话的目标标签页 |
| `browser_switch_tab` | 按 ID 或标题关键字切换到前台，并绑定页面 |
| `browser_snapshot` | 获取交互元素编号和 Snapshot ID |
| `browser_click` / `browser_type` | 点击 / 填写指定元素；可传 `snapshot_id` 校验版本 |
| `browser_press` / `browser_scroll` | 派发键盘事件 / 滚动页面 |
| `browser_navigate` | 在指定或已绑定页面导航 |
| `browser_get_text` | 提取元素文本、划选文本或正文，最多 20,000 字符 |
| `browser_wait` | 等待 0–30 秒 |

- 读取操作未绑定时跟随前台；修改、导航、滚动和关闭必须提供 `tab_id` 或先绑定页面。
- 显式目标或绑定目标失效后会报错，不会回退到另一个页面。
- 每个 MCP 连接拥有独立的绑定和窗口状态。扩展串行执行命令，防止异步操作互相覆盖。侧栏显示最近操作的会话，锁定按钮作用于该会话。
- 默认在独立后台工作窗口创建新标签页；这是界面上的分离，**仍共享同一浏览器配置和登录态**。
- 元素编号在同一文档生命周期内不复用；新快照使旧编号失效。建议点击、填写时始终同时传 `tab_id`、`snapshot_id`、`element_id`。
- 快照默认最多 50 个元素，可通过 `max_elements` 设置 1–500。`viewport_only: false` 仍遵守数量上限。
- 新建页面和导航等待浏览器加载完成，最多 10 秒；这不代表单页应用的异步业务数据已全部就绪。超时后先读取实际状态，避免重复提交。

## 安全边界与限制

- 服务仅监听 `127.0.0.1`；两类连接都必须提供配对令牌。浏览器网页来源被拒绝，扩展端点只接受扩展来源，已有浏览器连接不会被另一个连接替换。
- 令牌通过 WebSocket 子协议传递，不放入 URL。默认令牌文件位于用户目录，需保护本机用户账户和文件访问权限。获得令牌的本机进程具有浏览器控制能力。
- 日志只记录工具名称和目标标签页，不记录输入正文、URL 或令牌；输入成功消息不回显内容。密码、验证码和常见支付字段的快照值会脱敏，正文提取移除表单控件。
- 自动脱敏不能识别网页所有敏感内容；普通正文、链接、属性和用户主动划选的文字仍可能包含隐私。网页内容应作为不可信数据，不能作为额外操作授权。
- 点击、输入和键盘使用 DOM 合成事件，不提供真实用户事件保证；Tab、快捷键、文件选择器以及要求可信事件的网站可能不响应。Enter 在表单输入框内使用 `requestSubmit()`，保留表单校验。
- 当前不支持 iframe、Shadow DOM 和画布内容的完整访问，也不支持截图。扩展系统页、商店页等浏览器受保护页面不可操作。
- 多会话不会自动合并同一页面的操作意图；两个 Agent 操作同一页时仍应协调。不要让多个 Agent 同时填写同一表单。

## 开发与验证

在 `bridge-server` 目录运行：

```powershell
npm ci
npm run build
npm test
npm audit
```

测试覆盖配对与来源校验、连接替换防护、中继请求隔离、断线处理、失效标签页保护、会话绑定、文本域输入、敏感值回显及过期快照。

仓库包含 `dist` 供直接启动；修改 TypeScript 后必须重新构建并同步提交。CI 在 Windows 和 Linux 检查编译、回归测试与编译产物一致性。
