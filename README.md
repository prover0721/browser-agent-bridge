# 🌐 Browser Agent Extension & MCP Bridge (v1.2.0)

**Browser Agent** 是一套专为 AI Agent（如 Antigravity、Claude Code、Cursor 等）打造的**真实浏览器操控扩展（Chrome / Edge MV3）与本地 MCP 桥接服务**。

通过**纯文本结构化 DOM 索引、合成事件派发与【AI 专属独立工作窗口隔离机制】**，让 AI 在**不依赖昂贵、缓慢的视觉截图（Vision）**的前提下，直接操控真实浏览器，完美保留登录态，并实现**“主客分离”（用户主窗口零污染、零标签页打乱）**！

---

## 🌟 核心特色 (v1.2.0)

1. 🪟 **【主客分离】AI 专属独立工作窗口隔离（Dedicated AI Window）**：
   - AI 打开新网页、搜索、多步跳转时，会自动放入**独立的专属后台窗口**中执行；
   - **你的主浏览器窗口上方不会增加任何多余的 Tab 标签页，位置、数量完全保持原样，零干扰、零打扰**！
2. 📌 **后台标签页锁定与静默并发（Tab Pinning）**：
   - 即使你在前台做自己的事，AI 依然在专属窗口/后台标签页中持续点击、填表、翻页，互不影响。
3. ⚡ **纯文本结构化 DOM（零截图开销）**：
   - 毫秒级生成带编号的交互元素树，极低 Token 消耗，无视截图延迟与分辨率偏差。
4. 🧹 **窗口生命周期管理**：
   - 支持 `browser_create_window` 与 `browser_close_window`，任务完成后一键销毁后台工作窗口，干净利落。
5. 🔒 **严密隐私与安全**：
   - 密码框与支付卡号字段前端自动脱敏为 `••••`，局域网隔离（仅限 127.0.0.1 本地回环）。

---

## 📁 项目目录结构

```text
Browser_Agent_Extension_Bridge/
├── browser-extension/            # 浏览器扩展源码 (Chrome / Edge MV3)
│   ├── manifest.json             # 扩展清单文件 (v1.2.0)
│   ├── background.js             # Service Worker (AI 专属独立窗口隔离、WebSocket 连接、保活)
│   ├── content.js                # DOM 结构化解析、编号打标与事件派发
│   ├── sidepanel/                # 侧边栏 UI (连接状态、锁定指示、受控 Tab、操作审计日志)
│   └── icons/                    # 扩展图标
│
├── bridge-server/                # 本地 MCP 桥接服务端 (Node.js + TypeScript)
│   ├── package.json              # 依赖与脚本 (v1.2.0)
│   ├── tsconfig.json             # TypeScript 配置
│   ├── src/
│   │   ├── index.ts              # MCP Server 入口 (暴露 15 个标准工具，包含窗口隔离)
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

### 1. 窗口与多标签页隔离管理 (New in v1.2.0)
| 工具名称 | 功能描述 | 参数 |
| :--- | :--- | :--- |
| `browser_create_window` | 创建/激活独立的 AI 专属浏览器窗口（物理隔离主窗口） | `url` (可选), `focused` (是否前台显示) |
| `browser_close_window` | 任务完成后一键关闭整个 AI 专属工作窗口，清理所有后台任务 | 无 |
| `browser_create_tab` | 创建新网页（默认 `isolate_window: true` 自动放入专属独立窗口中） | `url`, `active`, `isolate_window`, `auto_bind` |
| `browser_list_tabs` | 列出浏览器所有打开的标签页（含窗口 ID、是否属于 AI 专属窗口） | 无 |
| `browser_bind_tab` | 将 AI 后续操作绑定到指定后台标签页 ID | `tab_id`: 目标标签页编号 |
| `browser_unbind_tab` | 解除标签页锁定，恢复为自动跟随前台活动标签页模式 | 无 |
| `browser_close_tab` | 关闭指定的标签页（或当前绑定的后台标签页） | `tab_id` (可选) |

### 2. 页面感知与 DOM 交互（支持跨 Tab / 跨窗口操作）
| 工具名称 | 功能描述 | 参数 |
| :--- | :--- | :--- |
| `browser_get_active_tab` | 获取当前受控网页的 URL、标题与所属窗口 ID | `tab_id` (可选) |
| `browser_snapshot` | 获取网页带 `[1]`, `[2]` 编号的结构化可交互元素快照 | `tab_id` (可选) |
| `browser_click` | 点击指定编号的元素（按钮/链接/复选框等） | `element_id`: 编号, `tab_id` (可选) |
| `browser_type` | 在指定输入框填入文本并触发响应式更新（支持专属窗口静默填表） | `element_id`, `text`, `clear_first`, `tab_id` |
| `browser_press` | 触发键盘按键（Enter / Tab / Escape 等） | `key`: 按键名称, `tab_id` (可选) |
| `browser_scroll` | 页面平滑滚动 | `direction`: 'down'/'up'/'top'/'bottom', `amount`: 像素 |
| `browser_navigate` | 在已锁定的专属标签页中跳转到指定 URL | `url`: 目标网址, `tab_id` (可选) |
| `browser_get_text` | 提取指定元素文本或用户在网页中划选的片段 | `element_id`, `tab_id` (可选) |
| `browser_wait` | 智能等待页面加载或异步渲染 | `seconds`: 等待秒数 |

---

## 🔒 隐私与安全性

1. **主客物理隔离**：AI 打开的任意页面均放入独立的专属窗口中，不污染、不打乱用户主工作窗口。
2. **敏感信息脱敏**：遇到密码输入框或支付卡号字段时，前端自动将内容脱敏为 `••••`，绝对不向模型上传真实密码。
3. **本地回环隔离**：WebSocket 服务严格绑定 `127.0.0.1`，拒绝来自局域网外部的未授权访问。
