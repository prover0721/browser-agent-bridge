# 🌐 Browser Agent Extension & MCP Bridge

**Browser Agent** 是一套专为 AI Agent（如 Antigravity、Claude Code、Cursor 等）打造的**真实浏览器操控扩展（Chrome / Edge MV3）与本地 MCP 桥接服务**。

通过**纯文本结构化 DOM 索引、合成事件派发与后台标签页锁定机制**，让 AI 在**不依赖昂贵、缓慢的视觉截图（Vision）**的前提下，直接操控你当前正在使用的真实浏览器窗口，完美保留所有网站的登录状态、Cookie 和会话，并支持**“人机并行双线程”（你在前台做你的，AI 在后台做它的）**！

---

## 🌟 核心特色

1. **真实浏览器环境**：保留已登录 Cookie、LocalStorage 与 Session 会话，免扫码、免二次登录。
2. **后台标签页锁定与并发（Tab Pinning）**：
   - AI 可以绑定后台特定的 Tab 标签页。
   - 即使你在前台切换到其他网页聊天、看视频、写代码，AI 的所有点击、填表、翻页指令依然在后台标签页中**静默持续执行**，互不干扰！
3. **纯文本结构化 DOM（零截图开销）**：毫秒级生成带编号的交互元素树，极低 Token 消耗，不卡顿。
4. **多标签页自主管理**：支持后台新建标签页、枚举当前标签页、跨 Tab 跳转与任务完成后自动关闭。
5. **严密隐私与安全**：密码框与敏感支付卡号前端自动脱敏为 `••••`，局域网隔离（仅限 127.0.0.1 本地回环）。

---

## 📁 项目目录结构

```text
Browser_Agent_Extension_Bridge/
├── browser-extension/            # 浏览器扩展源码 (Chrome / Edge MV3)
│   ├── manifest.json             # 扩展清单文件
│   ├── background.js             # Service Worker (WebSocket 连接、Tab 锁定调度与保活)
│   ├── content.js                # DOM 结构化解析、编号打标与事件派发
│   ├── sidepanel/                # 侧边栏 UI (连接状态、锁定指示、受控 Tab、操作审计日志)
│   └── icons/                    # 扩展图标
│
├── bridge-server/                # 本地 MCP 桥接服务端 (Node.js + TypeScript)
│   ├── package.json              # 依赖与脚本
│   ├── tsconfig.json             # TypeScript 配置
│   ├── src/
│   │   ├── index.ts              # MCP Server 入口 (Stdio Transport)
│   │   ├── ws-bridge.ts          # WebSocket 服务 (ws://127.0.0.1:3088/ws)
│   │   └── types.ts              # 类型定义
│   └── dist/                     # 编译输出目录
│
├── antigravity_mcp_config.json   # MCP 配置文件示例
└── README.md                     # 使用说明文档
```

---

## 🚀 快速开始使用指南

### 第一步：在 Edge 或 Chrome 浏览器中加载扩展

1. 打开 **Microsoft Edge** 浏览器，访问：
   ```text
   edge://extensions/
   ```
   *(如果是 Chrome 浏览器，访问 `chrome://extensions/`)*
2. 开启左侧的 **“开发人员模式”** (Developer mode)。
3. 点击顶部的 **“加载解压缩的扩展”** (Load unpacked)。
4. 选择本项目中的 `browser-extension` 文件夹：
   ```text
   d:\ai\antigravity\work\Browser_Agent_Extension_Bridge\browser-extension
   ```
5. 在浏览器工具栏中将 **Browser Agent** 图标固定，点击即可展开右侧侧边栏。

---

### 第二步：配置并接入 Antigravity / AI 编程助手

将本 MCP 服务添加到您的 MCP 配置文件中（如 `mcp_config.json` 或 Claude Desktop）：

```json
{
  "mcpServers": {
    "browser_bridge": {
      "command": "node",
      "args": [
        "d:/ai/antigravity/work/Browser_Agent_Extension_Bridge/bridge-server/dist/index.js"
      ],
      "env": {
        "BRIDGE_PORT": "3088"
      }
    }
  }
}
```

---

## 🛠️ 暴露给 AI 的核心工具集 (MCP Tools)

### 1. 标签页与后台多任务管理
| 工具名称 | 功能描述 | 参数 |
| :--- | :--- | :--- |
| `browser_list_tabs` | 列出浏览器所有打开的标签页（ID、标题、URL、是否激活、是否锁定） | 无 |
| `browser_create_tab` | 在后台静默创建全新标签页（默认不抢占前台屏幕，自动锁定） | `url`: 目标网址, `active`: 是否前台显示 |
| `browser_bind_tab` | 将 AI 后续的所有操作锁定到指定后台标签页 ID（支持跨页面并发） | `tab_id`: 目标标签页编号 |
| `browser_unbind_tab` | 解除标签页锁定，恢复为自动跟随用户前台活动标签页模式 | 无 |
| `browser_close_tab` | 关闭指定的标签页（或当前绑定的后台标签页） | `tab_id` (可选) |

### 2. 页面感知与 DOM 交互（支持可选 `tab_id` 指定后台标签）
| 工具名称 | 功能描述 | 参数 |
| :--- | :--- | :--- |
| `browser_get_active_tab` | 获取当前受控网页的 URL 和标题 | `tab_id` (可选) |
| `browser_snapshot` | 获取网页带 `[1]`, `[2]` 编号的结构化可交互元素快照 | `tab_id` (可选) |
| `browser_click` | 点击指定编号的元素（按钮/链接/复选框等） | `element_id`: 编号, `tab_id` (可选) |
| `browser_type` | 在指定输入框填入文本并触发响应式更新（支持后台静默填表） | `element_id`, `text`, `clear_first`, `tab_id` |
| `browser_press` | 触发键盘按键（Enter / Tab / Escape 等） | `key`: 按键名称, `tab_id` (可选) |
| `browser_scroll` | 页面平滑滚动 | `direction`: 'down'/'up'/'top'/'bottom', `amount`: 像素 |
| `browser_navigate` | 在当前/后台标签页中跳转到指定 URL | `url`: 目标网址, `tab_id` (可选) |
| `browser_get_text` | 提取指定元素文本或用户在网页中划选的片段 | `element_id`, `tab_id` (可选) |
| `browser_wait` | 智能等待页面加载或异步渲染 | `seconds`: 等待秒数 |

---

## 🔒 隐私与安全性

1. **敏感信息脱敏**：遇到密码输入框或支付卡号字段时，前端自动将内容脱敏为 `••••`，绝对不向模型上传真实密码。
2. **本地回环隔离**：WebSocket 服务严格绑定 `127.0.0.1`，拒绝来自局域网外部的未授权访问。
3. **操作透明可审计**：所有由 AI 发起的点击、输入、导航指令均会实时记录在浏览器侧边栏的“审计日志”面板中。
