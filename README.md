# 🌐 Browser Agent Extension & MCP Bridge

**Browser Agent** 是一套专为 AI Agent（如 Antigravity、Claude Code、Cursor 等）打造的**真实浏览器操控扩展（Chrome / Edge MV3）与本地 MCP 桥接服务**。

通过**纯文本结构化 DOM 索引与合成事件派发**，让 AI 在**不依赖昂贵、缓慢的视觉截图（Vision）**的前提下，直接操控你当前正在使用的真实浏览器窗口，完美保留所有网站的登录状态、Cookie 和会话。

---

## 📁 项目目录结构

```text
Browser_Agent_Extension_Bridge/
├── browser-extension/            # 浏览器扩展源码 (Chrome / Edge MV3)
│   ├── manifest.json             # 扩展清单文件
│   ├── background.js             # Service Worker (WebSocket 连接与消息中枢)
│   ├── content.js                # DOM 结构化解析、编号打标与事件派发
│   ├── sidepanel/                # 侧边栏 UI (连接状态指示、受控 Tab、操作审计日志)
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

1. 打开 **Microsoft Edge** 浏览器，在地址栏输入并回车：
   ```text
   edge://extensions/
   ```
   *(如果是 Chrome 浏览器，访问 `chrome://extensions/`)*
2. 开启左侧/左下角的 **“开发人员模式”** (Developer mode) 开关。
3. 点击顶部的 **“加载解压缩的扩展”** (Load unpacked) 按钮。
4. 选择本项目中的 `browser-extension` 文件夹：
   ```text
   d:\ai\antigravity\work\Browser_Agent_Extension_Bridge\browser-extension
   ```
5. 在浏览器工具栏中将 **Browser Agent** 图标固定，点击即可展开右侧侧边栏。

---

### 第二步：编译与启动本地 MCP 桥接服务

进入 `bridge-server` 目录并启动：

```powershell
cd d:\ai\antigravity\work\Browser_Agent_Extension_Bridge\bridge-server

# 安装依赖并编译 (若已编译可跳过)
npm install
npm run build

# 启动服务
npm start
```

启动后，浏览器侧边栏的状态指示灯会自动变为绿色的 **🟢 已连接 (:3088)**。

---

### 第三步：配置并接入 Antigravity / AI 编程助手

将本 MCP 服务添加到您的 MCP 配置文件中（如 Antigravity 或 Claude Desktop）：

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

| 工具名称 | 功能描述 | 参数 |
| :--- | :--- | :--- |
| `browser_get_active_tab` | 获取当前活动受控网页的 URL 和标题 | 无 |
| `browser_snapshot` | 获取网页带 `[1]`, `[2]` 编号的结构化可交互元素快照 | 无 |
| `browser_click` | 点击指定编号的元素（按钮/链接等） | `element_id`: 元素编号数字 |
| `browser_type` | 在指定输入框填入文本并触发响应式更新 | `element_id`: 输入框编号, `text`: 输入文本, `clear_first`: 是否清空 |
| `browser_press` | 触发特定键盘按键（Enter / Tab / Escape 等） | `key`: 按键名称 |
| `browser_scroll` | 页面平滑滚动 | `direction`: 'down'/'up'/'top'/'bottom', `amount`: 滚动像素 |
| `browser_navigate` | 在当前标签页中跳转到指定 URL | `url`: 目标网址 |
| `browser_get_text` | 提取指定元素文本或用户在网页中划选的片段 | `element_id` (可选) |
| `browser_wait` | 智能等待页面加载或异步渲染 | `seconds`: 等待秒数 |

---

## 🔒 隐私与安全性

1. **敏感信息脱敏**：遇到密码输入框或支付卡号字段时，前端自动将内容脱敏为 `••••`，绝对不向模型上传真实密码。
2. **本地回环隔离**：WebSocket 服务严格绑定 `127.0.0.1`，拒绝来自局域网外部的未授权访问。
3. **操作透明可审计**：所有由 AI 发起的点击、输入、导航指令均会实时记录在浏览器侧边栏的“审计日志”面板中。
