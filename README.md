<div align="center">

# 🌐 Browser Agent Bridge

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/prover0721/browser-agent-bridge)
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
| `browser_snapshot` | 获取交互元素编号和 Snapshot ID（默认视口优先智能瘦身，支持活动弹窗置顶与 `ignore_dialog: true` 穿透，支持 `diff_only: true` 增量快照） |
| `browser_click` | **【v2.0+ 推荐】点击元素（支持编号/文字/选择器与 CDP 原生受信任点击）**：支持 `trusted: true` 原生硬件级事件（攻克应届生网/银行等反爬控件）、`humanlike: true` 拟人化延迟；自动回传即时动作反馈（Toast/报错/跳转） |
| `browser_type` | **【v2.0+ 推荐】填写元素（支持受信任输入与只读控件解锁）**：支持 `trusted: true` 原生 CDP 键入、自动解锁自制日历等 readonly 输入框；自动回传动作反馈 |
| `browser_hover` | **【v1.9.3+ 推荐】鼠标悬停/Hover**：精准悬停在卡片或元素上，唤醒 React/Vue 条件浮层按钮（如 BOSS直聘简历的「编辑」「添加」「同步」按钮） |
| `browser_press` / `browser_scroll` | 派发键盘事件 / 滚动页面（附带滚动位置与进度百分比指示） |
| `browser_drag` | **【v2.0+ 推荐】拟人化拖拽与滑块验证一键过**：模拟真实手部 Ease-Out 变速曲线与微抖动，专治阿里WAF/51job/应届生网/极验等滑动验证码（"请按住滑块，拖动到最右边"），自动计算轨道宽度并借助 CDP trusted 原生事件秒级滑过 |
| `browser_screenshot` | **【v2.0+ 推荐】靶向视觉快照与局部裁切**：截取当前视口高清图像，支持指定 `element_id` 或 `selector` 裁切验证码、图表等关键元素，返回 base64 图像与绝对坐标 |
| `browser_set_guard` | **【v2.0+ 推荐】AI 任务导航安全护栏**：设置当前任务允许访问的域名白名单（`domain_lock: ["*.zhipin.com", "yingjiesheng.com"]`），严密阻断非预期外链跳转与钓鱼网址 |
| `browser_navigate` | 在指定或已绑定页面导航（后台自主导航零打扰，受安全护栏保护） |
| `browser_get_text` | 提取元素文本、划选文本或正文，最多 20,000 字符 |
| `browser_wait` | 静态等待指定秒数（0–30 秒） |
| `browser_wait_for` | **【v1.5+ 推荐】智能条件等待**：毫秒级监听 DOM 变化，直到指定选择器或文字出现/消失时立即返回 |
| `browser_upload_file` | **【v1.6+ 推荐】全自动文件上传**：直接注入本地文件到网页上传控件，免系统弹窗，零人工介入 |
| `browser_list_bookmarks` | **【v1.7+ 推荐】书签全量检索**：递归检索全量收藏夹（书签栏、其他收藏夹及所有子目录），支持按标题/网址/文件夹模糊搜索 |
| `browser_open_bookmark` | **【v1.7+ 推荐】书签一键直达**：智能匹配收藏夹目标网站并在【AI 专属独立窗口】中隔离打开或指定标签页跳转 |
| `browser_get_cookies` | **【v1.8+ 推荐】免 F12 直取 Cookies**：原生直取目标站全量 Cookie（包含 `HttpOnly`、`Secure` 敏感鉴权），支持按键名精准查找 |
| `browser_get_storage` | **【v1.8+ 推荐】免 F12 获取存储**：提取当前页面或指定标签页的 `localStorage` 和 `sessionStorage` 完整键值 |
| `browser_evaluate` | **【v1.8+ 推荐】免 F12 执行控制台 JS**：在网页上下文中执行自定义只读 JS 表达式，快速提取内部状态或全局变量 |
| `browser_wait_for_download` | **【v1.9+ 推荐】下载感知与绝对路径追踪**：毫秒级监听导出报表/下载简历完成，直接返回本地操作系统的绝对路径 |
| `browser_get_downloads` | **【v1.9+ 推荐】下载历史记录查询**：检索最近下载的文件列表、本地存储路径、文件大小与下载状态 |
| `browser_get_network_logs` | **【v1.9+ 推荐】DevTools 网络接口嗅探**：捕获异步 Fetch/XHR 请求及后端返回的原始 JSON，免去繁琐的 DOM 翻页解析 |
| `browser_fill_form` | **【v1.9+ 推荐】单次批量快速填表**：一次性填写多个输入框、下拉框或富文本项，通信效率与填表速度提升 10 倍 |
| `browser_go_back` / `browser_go_forward` / `browser_reload` | **【v1.9+ 推荐】基础导航控制**：控制当前受控标签页后退、前进或硬刷新 |
| `browser_reload_extension` | **【v1.9.2+ 推荐】一键/自动热重载扩展**：执行 `chrome.runtime.reload()` 秒级重载扩展并同步刷新受控网页，免去手动前往 `chrome://extensions` 页面刷新的繁琐步骤 |

- **CDP 原生受信任输入与应届生求职网/复杂表单破解 (v2.0.0 重磅升级)**：
  - **CDP 原生硬件级受信任输入 (`trusted: true`)**：利用 `chrome.debugger` (Chrome DevTools Protocol) 派发底层的 `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent` 和 `Input.insertText`。生成的事件对象原生自带 `event.isTrusted === true`，彻底攻克**应届生求职网（yingjiesheng）**教育经历在校时间等只认真实键鼠事件的自研/第三方日历与下拉控件。
  - **拟人化物理拖拽与滑动验证码专解 (`browser_drag`)**：提供专治阿里 WAF、51job、极验等滑块验证码（“请按住滑块，拖动到最右边”）的物理拖拽工具，支持自动探测滑块按钮与轨道宽度，模拟三次贝塞尔变速与高斯手震，配合 CDP 原生受信任事件一键滑过。
  - **深度反爬指纹伪装 (Stealth 2.0) 与 CDP 自动脱钩**：在 `Navigator.prototype` 上标准化伪装 `webdriver: false`（保证 `hasOwnProperty('webdriver') === false`），补全 Chrome 内部运行时属性（`chrome.csi`, `chrome.app`, `chrome.loadTimes`），CDP 键鼠操作完成后 600ms 自动脱钩，彻底隐匿自动化痕迹。
  - **自研日历控件只读解锁与主世界 isTrusted 增强**：针对前端日历控件给 `<input readonly>` 设置只读属性拦截键入的模式，在填表与输入前自动临时剥除只读限制并同步触发 `change` 与 `blur` 刷新；并在主世界对标记事件模拟 `isTrusted` 原型劫持，提供双重兜底保障。
  - **闭环动作即时反馈机制 (Action Feedback Loop)**：每次执行 `browser_click` 或 `browser_type` 后，系统自动扫描并返回当前界面的反馈状态（包含全局 Toast / 消息提示、表单红字校验错误、URL 是否发生变化等），使 AI 无需频繁调用完整快照即可感知“是否保存成功”或“漏填了哪一项”。
  - **靶向视觉快照与局部裁切 (`browser_screenshot`)**：支持对整个视口截屏，更支持指定 `element_id` 或 `selector` 对验证码、图表、二维码进行高精度像素级视口裁切，与视觉大模型无缝配合。
  - **智能增量快照 (`diff_only: true`)**：对比上一次快照版本，仅输出 DOM 树中新增、变更或移除的元素条目，在复杂后台管理系统和动态长页面中单步降低 90% 的 Context 消耗。
  - **AI 导航安全护栏 (`browser_set_guard`)**：支持任务级域名白名单锁定，强行拦截非预期重定向与钓鱼外链跳转，保障无人值守自动化运行安全。
- **后台渲染保活与假弹窗过滤 (v1.9.5 新增)**：
  - **主世界 Page Visibility 伪装与底层时钟保活**：拦截重写 `document.visibilityState` 为 `'visible'`、`document.hidden` 为 `false`，并对 `document.hasFocus()` 恒真，结合无声 AudioContext 保持底层事件循环活跃，彻底破除 Chromium 后台 0 FPS 冻结与定时器降频（Timer Alignment），解决单页应用（SPA）在后台“未命名”和卡在加载骨架屏的顽疾。
  - **严格弹窗判定与穿透容错 (Anti-Ghost Dialog Filter)**：移除 `.chat-conversation` 等常规主页面容器误报；排除 0 尺寸与无交互子元素的骨架占位；取消将主内容区主观标记为“底层遮罩（操作受限）”，支持 `ignore_dialog: true` 一键穿透任意浮层直接操作主界面。
  - **标准化桌面级后台视口 (1440x900) 与后台静音**：为 AI 专属后台工作窗口赋予 1440x900 标准桌面分辨率，杜绝小窗口触发移动端汉堡菜单折叠；自动为后台任务标签页开启静音（`muted: true`），零干扰用户前台工作。
- **语义动作穿透与多模态点击 (v1.9.4 新增)**：
  - **React 合成事件与无原生属性动作穿透**：针对 BOSS直聘等现代 React 应用采用顶层合成事件代理（SyntheticEvent），且操作按钮为普通 `<span>`/`<div>`（静态无 `cursor: pointer` 且 `el.onclick === null`），快照收集器通过语义动作关键词（如“编辑”、“添加”、“同步”、“删除”、“修改”等）与常见 class 模式直接穿透判定为交互元素，不再因缺少原生点击属性被误过滤。
  - **快照动态 CSS 浮层样式强制注入**：在快照提取期间向页面注入隔离样式表，强制展现常态下被 CSS `:hover` 伪类隐藏的卡片操作层与按钮，突破 CSS hover 隔离。
  - **基于文字与选择器的直达点击 (`browser_click`)**：除通过快照编号 `element_id` 点击外，新增支持直接指定按钮文字（`text: "编辑"` / `text: "同步至在线简历"`）或 CSS 选择器（`selector`）触发点击，并在触发前自动沿 DOM 树向上回溯派发 4 级父容器 hover 模拟，告别因快照失效或编号缺失导致的点击失败。
- **React 悬浮浮层与 Hover 按钮智能透出 (v1.9.3 新增)**：
  - **快照智能扫描唤醒 (`reveal_hover: true`)**：`browser_snapshot` 在收集元素前自动向卡片/列表容器（`.resume-item`, `.card` 等）微秒级派发指针与鼠标 hover 链，促使 React 的 `onMouseEnter` 自动挂载浮层按钮（如 BOSS直聘在线简历页的「编辑」「添加」「同步」按钮），并在快照中标记为 `[hover]` 供 AI 直接点击。
  - **显式悬停交互工具 (`browser_hover`)**：支持通过 `element_id`、`selector` 或包含的 `text`（如 "工作经历"）将鼠标悬停在指定区块，触发展开下拉菜单或浮层交互。
  - **放宽 Hover 操作按钮可见性**：识别 `visibility: hidden` 但具备操作语义（“编辑”、“添加”、“同步”、“删除”等）的按钮，不再因常态样式被误杀。
- **全自动化热重载与开发自愈体系 (v1.9.2 新增)**：
  - **文件变动自动热重载 (File-Watcher Hot Reload)**：Bridge Server 后台实时监听 `browser-extension/` 目录所有文件变动。只要代码修改保存，服务在 300ms 内自动通过 WebSocket 广播热重载信号，扩展调用 `chrome.runtime.reload()` 秒级热重载，实现**保存即生效**。
  - **AI 一键运维工具 (`browser_reload_extension`)**：AI 或开发者可直接派发重载指令，支持可选参数 `reload_tabs: true` 自动同步刷新当前活动网页，使新版脚本立即注入，彻底杜绝孤儿脚本报错（`Extension context invalidated`）。
  - **侧边栏 (Sidepanel) 一键重载捷径**：在侧边栏配置区直接集成「🔄 重载扩展」按钮，随时可在当前网页一键重启插件与刷新页面。
- **学习通/在线考核平台 iframe 穿透与反粘贴破解 (v1.9.1 新增)**：
  - **全子框架穿透 (`all_frames: true`)**：扩展脚本自动穿透所有子 iframe 和空白载入页（如在线试卷、问卷星、UEditor 富文本框），消除 iframe 隔离盲区。
  - **主世界反粘贴/反复制解锁**：在页面主世界无侵入式注入捕获级事件监听器与属性重写，彻底中和各类网课、考试系统对 `paste`、`copy`、`contextmenu` 事件的 `preventDefault()` 与 `return false` 封锁，实现 100% 顺畅填表。
- **BOSS直聘/Quill/WangEditor 富文本段落保护与字数联动 (v1.9.1 加固)**：
  - **保留富文本段落与光标折叠**：严格禁止破坏富文本 DOM 树的简单清空，自动保护与补齐根节点段落（如 `<p><br></p>`），精准将光标（Range）聚焦到段落内部再执行文本注入。
  - **全套键盘与输入事件链触发**：同步派发 `beforeinput`、`input`、`keydown`、`keypress`、`keyup`、`change`，确保 BOSS直聘“字数: 0 / 1000”、表单必填校验及 React/Vue 监听即时生效。
- **闭环文件流：下载监听与绝对路径追踪 (`browser_wait_for_download` / `browser_get_downloads`)**：借助原生 `chrome.downloads` 权限实时监听点击“导出 Excel”、“下载简历”后的下载任务，在下载完成后毫秒级返回本地磁盘的绝对路径（如 `C:\Users\...\Downloads\report.xlsx`），与 `browser_upload_file` 组合实现真正的文件流双向闭环。
- **DevTools 终极拼图：动态网络接口嗅探 (`browser_get_network_logs`)**：无侵入式拦截页面 `window.fetch` 与 `XMLHttpRequest`，实时记录最近的 API 请求与干净 JSON 响应体。在处理列表、动态渲染或表格抓取时，AI 可以直取结构化后端数据，免去大量 DOM 视口滚动与快照 Token 消耗。
- **单次批量表单填充 (`browser_fill_form`)**：针对求职投递、政企申报等长表单，支持一次传入全部字段列表并在页面端批量模拟原生键入与虚拟 DOM 状态更新，单次完成所有表单项填写。
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

全套 50 项测试覆盖拟人化物理拖拽与滑动验证码自动破解、Stealth 2.0 深度反爬指纹伪装、CDP 原生受信任输入与拟人化延迟、应届生网自定义日历只读绕过、即时动作反馈（Toast/校验拦截）、增量快照 diff、局部视觉裁切截图、AI 导航安全白名单护栏、后台渲染保活与无声时钟唤醒、弹窗严格过滤与穿透参数、标准桌面视口与静音保障、语义动作穿透与文字直达点击、本地下载路径追踪、网络接口嗅探、批量表单填充、历史导航、免 F12 获取 Cookies 与存储、扩展自动热重载与网页同步、React 动态 hover 浮层挂载与悬停透出、BOSS直聘富文本与复杂弹窗、Quill/WangEditor 段落保留与字数计数器同步、书签全量检索与直达、文件注入上传、Shadow DOM 遍历、活动弹窗分组、条件等待、后台独立窗口创建与复用、静默切页、自主导航、无令牌自动连接、会话绑定及过期快照。

修改 TypeScript 后必须重新构建并同步提交。CI 在 Windows 和 Linux 检查编译、回归测试与编译产物一致性。
