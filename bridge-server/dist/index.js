"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// index.ts - Main MCP Server Entry (v1.2.0 Dedicated Window Isolation)
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const ws_bridge_1 = require("./ws-bridge");
const dotenv_1 = __importDefault(require("dotenv"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
dotenv_1.default.config();
const port = Number(process.env.BRIDGE_PORT || '3088');
const bridge = new ws_bridge_1.WebSocketBridge(port);
bridge.start();
// 自动监听扩展代码变动并向扩展推送热重载信号 (Auto-reload file watcher for extension)
const possibleExtensionDirs = [
    node_path_1.default.resolve(__dirname, '../../browser-extension'),
    node_path_1.default.resolve(__dirname, '../browser-extension'),
    node_path_1.default.resolve(process.cwd(), 'browser-extension'),
    node_path_1.default.resolve(process.cwd(), '../browser-extension')
];
const extensionDir = possibleExtensionDirs.find(p => node_fs_1.default.existsSync(p));
let hotReloadDebounce = null;
if (extensionDir) {
    try {
        node_fs_1.default.watch(extensionDir, { recursive: true }, (eventType, filename) => {
            if (!filename || filename.endsWith('.swp') || filename.endsWith('~') || filename.startsWith('.'))
                return;
            if (hotReloadDebounce)
                clearTimeout(hotReloadDebounce);
            hotReloadDebounce = setTimeout(() => {
                console.error(`[Hot-Reload] Extension file changed (${filename}), broadcasting hot-reload to browser...`);
                bridge.broadcastHotReload();
            }, 300);
        });
        console.error(`[Hot-Reload] Watching extension directory at ${extensionDir}`);
    }
    catch (err) {
        console.error('[Hot-Reload] Failed to watch extension folder:', err.message);
    }
}
const MIME_MAP = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel'
};
// 创建 MCP Server 实例
const server = new index_js_1.Server({
    name: 'browser-agent-bridge',
    version: '1.9.3',
}, {
    capabilities: {
        tools: {},
    },
});
// 定义暴露给 AI 的标准浏览器操作工具集
const TOOLS = [
    // ── 1. 窗口与多标签页隔离管理 ──
    {
        name: 'browser_create_window',
        description: '开始后台任务：新建或复用当前会话的 AI 专用窗口并绑定工作页，默认不抢前台。重复调用不会额外创建标签页；传 url 可跳转工作页。',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '可选：工作页网址；新窗口默认 Bing，复用窗口且不传 url 时保留原页面',
                },
                focused: {
                    type: 'boolean',
                    description: '是否抢占屏幕前台焦点，默认为 false（即在后台静默运行，不打扰用户）',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_close_window',
        description: '任务完成后一键关闭整个 AI 专属独立工作窗口，彻底清理所有临时任务网页，不留痕迹。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'browser_create_tab',
        description: '【打开新网页首选】在浏览器中创建一个全新的网页标签页。默认 isolate_window: true 会自动放入【AI 专属独立窗口】中，绝不在用户主窗口中新增标签页，实现零干扰。',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要打开的目标网址（如 "https://www.bing.com"）',
                },
                active: {
                    type: 'boolean',
                    description: '是否显示 AI 工作窗口，默认 false；后台任务保持 false',
                },
                isolate_window: {
                    type: 'boolean',
                    description: '是否放入 AI 专属独立窗口隔离运行，默认为 true（强力推荐保持 true，保护用户主窗口）',
                },
                auto_bind: {
                    type: 'boolean',
                    description: '是否自动将此新标签页锁定为 AI 后续指令的专属执行区，默认为 true',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'browser_list_tabs',
        description: '获取当前浏览器中所有已打开的标签页列表（包含每个标签页的 ID、窗口 ID、是否属于 AI 专属窗口、标题、URL、是否处于活动状态、是否已被锁定为后台工作区）。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'browser_bind_tab',
        description: '将后续的所有操作（点击、填表、抓取等）强制绑定到指定的标签页 ID。锁定后，用户在前台切换到任意其他页面做别的事，AI 依然会在该后台标签页中持续工作。',
        inputSchema: {
            type: 'object',
            properties: {
                tab_id: {
                    type: 'number',
                    description: '要锁定的目标标签页 ID（可从 browser_list_tabs 中获取）',
                },
            },
            required: ['tab_id'],
        },
    },
    {
        name: 'browser_unbind_tab',
        description: '解除对特定标签页的后台锁定，恢复为“自动跟随用户当前前台活动标签页”的默认模式。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'browser_switch_tab',
        description: '切换 AI 受控标签页，默认不改变前台显示。有工作窗口时，关键词默认只搜索该窗口。仅在用户要求展示结果时传 focused: true。',
        inputSchema: {
            type: 'object',
            properties: {
                focused: { type: 'boolean', description: '是否将目标窗口和标签页显示到前台，默认 false' },
                tab_id: {
                    type: 'number',
                    description: '可选：要切换到的目标标签页 ID',
                },
                title: {
                    type: 'string',
                    description: '可选：目标标签页的标题或标题包含的关键字（例如 "物联网平台"、"监控页"）',
                },
                keyword: {
                    type: 'string',
                    description: '可选：网址或标题模糊搜索关键字',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_close_tab',
        description: '关闭指定的标签页。如果不传 tab_id，则关闭当前绑定的后台工作标签页。',
        inputSchema: {
            type: 'object',
            properties: {
                tab_id: {
                    type: 'number',
                    description: '可选：要关闭的标签页 ID',
                },
            },
        },
    },
    // ── 1.5 浏览器书签与收藏夹管理 ──
    {
        name: 'browser_list_bookmarks',
        description: '【书签查询】全量递归检索浏览器收藏夹（涵盖"收藏夹栏"、"其他收藏夹"、"移动设备收藏夹"及所有深层子文件夹）。支持按关键字模糊搜索标题/网址，或按文件夹名称筛选。',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '可选：书签标题或网址的搜索关键词（如 "github"、"控制台"、"docs"）',
                },
                folder: {
                    type: 'string',
                    description: '可选：收藏夹文件夹名称筛选（如 "其他收藏夹"、"工作"、"AI工具"）',
                },
                limit: {
                    type: 'number',
                    description: '可选：最大返回条数（默认 50，避免返回过多）',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_open_bookmark',
        description: '【书签直达】一键打开浏览器收藏夹中的目标网站。支持输入书签 ID、标题关键词或文件夹筛选，自动匹配最优书签并在【AI 专属独立窗口】中隔离打开或在指定标签页中加载。',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: '可选：精准书签 ID（可从 browser_list_bookmarks 中获取）',
                },
                query: {
                    type: 'string',
                    description: '可选：书签名称或网址搜索关键词（如 "阿里云"、"GitHub"、"Bilibili"）',
                },
                folder: {
                    type: 'string',
                    description: '可选：限定搜索的文件夹名称（如 "其他收藏夹"、"工具"）',
                },
                isolate_window: {
                    type: 'boolean',
                    description: '是否放入 AI 专属独立窗口隔离运行，默认为 true（保护用户主窗口）',
                },
                active: {
                    type: 'boolean',
                    description: '是否将窗口显示到前台，默认为 false（后台静默运行）',
                },
                auto_bind: {
                    type: 'boolean',
                    description: '是否自动锁定为此后台工作标签页，默认为 true',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：若指定已有的标签页 ID，则在该标签页中直接跳转打开，而不创建新标签页',
                },
            },
            required: [],
        },
    },
    // ── 1.6 开发者信息免 F12 获取 (Cookies, Storage, Console) ──
    {
        name: 'browser_get_cookies',
        description: '【免 F12 直取 Cookies】原生直接获取目标网址（如 "https://gemini.google.com"）或当前页面的所有 Cookie（包含 HttpOnly、Secure 等字段，无视普通脚本限制）。支持按指定 Cookie 名称（如 "__Secure-1PSID"）精确提取键值对，告别繁琐的手动 F12 复制。',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '可选：目标网站完整网址（如 "https://gemini.google.com"），不传则默认使用当前受控标签页网址',
                },
                domain: {
                    type: 'string',
                    description: '可选：目标域名（如 "google.com"、"github.com"）',
                },
                name: {
                    type: 'string',
                    description: '可选：单个 Cookie 名称进行精确查找',
                },
                names: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '可选：多个 Cookie 名称数组（如 ["__Secure-1PSID", "__Secure-1PSIDTS"]）',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定标签页 ID 获取其 Cookie',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_get_storage',
        description: '【免 F12 获取本地存储】提取目标网页的 localStorage 和 sessionStorage 数据，支持按 key 精确查找或全量导出。',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['all', 'local', 'session'],
                    description: '提取类型：默认为 "all"（同时提取 localStorage 与 sessionStorage），也可选 "local" 或 "session"',
                },
                keys: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '可选：指定要提取的 key 名称数组，不传则提取全部',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_evaluate',
        description: '【免 F12 执行控制台 JS 表达式】在目标网页上下文中执行自定义只读 JavaScript 表达式并获取返回值（类似 F12 Console），可用于提取 window 全局变量或内部状态。',
        inputSchema: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: '要执行的 JavaScript 表达式代码（如 "window.__INITIAL_STATE__" 或 "document.title"）',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
            required: ['expression'],
        },
    },
    // ── 1.7 闭环文件流与下载管理 ──
    {
        name: 'browser_wait_for_download',
        description: '【下载感知与本地路径追踪】等待当前页面或会话触发的文件下载完成，并返回该文件在本地操作系统的【绝对文件路径】（如 "C:\\Users\\...\\Downloads\\report.xlsx"）。与 browser_upload_file 组合实现文件上传/下载双向闭环。',
        inputSchema: {
            type: 'object',
            properties: {
                timeout_seconds: {
                    type: 'number',
                    description: '可选：最长等待秒数（默认 30 秒，最大 120 秒）',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_get_downloads',
        description: '【下载历史记录查询】查询浏览器最近的下载文件列表，包含本地路径、文件大小、MIME 类型与下载状态。',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '可选：按文件名或网址搜索下载记录',
                },
                state: {
                    type: 'string',
                    enum: ['in_progress', 'interrupted', 'complete'],
                    description: '可选：按状态筛选',
                },
                limit: {
                    type: 'number',
                    description: '可选：最大返回记录数（默认 10）',
                },
            },
            required: [],
        },
    },
    // ── 1.8 动态网络嗅探与接口日志 ──
    {
        name: 'browser_get_network_logs',
        description: '【DevTools 网络接口嗅探】捕获网页发出的动态异步网络请求（Fetch / XHR）及后端 API 返回的原始 JSON 响应体。免去繁琐的翻页与 DOM 快照，直接读取结构化干净数据。',
        inputSchema: {
            type: 'object',
            properties: {
                url_pattern: {
                    type: 'string',
                    description: '可选：网址关键词匹配（如 "api/jobs"、"list"、".json"）',
                },
                method: {
                    type: 'string',
                    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                    description: '可选：HTTP 请求方法',
                },
                status_code: {
                    type: 'number',
                    description: '可选：HTTP 状态码（如 200）',
                },
                limit: {
                    type: 'number',
                    description: '可选：最多返回的日志条数（默认 20，最大 100）',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定受控标签页 ID',
                },
            },
            required: [],
        },
    },
    // ── 1.9 批量表单填充与基础历史导航 ──
    {
        name: 'browser_fill_form',
        description: '【单次批量快速填表】一次性批量填写当前页面中的多个输入框、下拉框或富文本项，告别多轮通信往返，长表单填写效率倍增。',
        inputSchema: {
            type: 'object',
            properties: {
                fields: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            element_id: { type: 'number', description: '目标元素的编号 ID' },
                            value: { type: 'string', description: '要填入的内容' },
                            clear_first: { type: 'boolean', description: '是否先清空已有内容，默认 true' },
                        },
                        required: ['element_id', 'value'],
                    },
                    description: '要填写的字段数组列表',
                },
                snapshot_id: {
                    type: 'string',
                    description: '可选：快照 ID，用于 DOM 时效性版本校验',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
            required: ['fields'],
        },
    },
    {
        name: 'browser_go_back',
        description: '控制当前受控标签页在浏览器历史记录中后退一步（相当于点击浏览器后退按钮）。',
        inputSchema: {
            type: 'object',
            properties: {
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_go_forward',
        description: '控制当前受控标签页在浏览器历史记录中前进一步（相当于点击浏览器前进按钮）。',
        inputSchema: {
            type: 'object',
            properties: {
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_reload',
        description: '重新加载刷新当前受控标签页（相当于点击浏览器刷新按钮）。',
        inputSchema: {
            type: 'object',
            properties: {
                bypass_cache: {
                    type: 'boolean',
                    description: '是否强制忽略缓存硬刷新，默认为 false',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
            required: [],
        },
    },
    // ── 2. 页面感知与信息提取 ──
    {
        name: 'browser_get_active_tab',
        description: '获取当前受控标签页（优先返回锁定的后台标签页，若未锁定则返回前台活动标签页）的 URL、标题、窗口 ID 和运行模式。',
        inputSchema: {
            type: 'object',
            properties: {
                tab_id: {
                    type: 'number',
                    description: '可选：指定要查询的标签页 ID',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_snapshot',
        description: '获取目标网页的结构化纯文本快照（包含带有 [1], [2] 等数字编号的交互元素，如按钮、输入框、链接等）。已内置【视口优先（In-Viewport）智能降噪与 Token 瘦身】，默认只返回当前屏幕可见范围内的核心元素并附带滚动位置指示，极度节省 Token。若需查看全页元素，可传 viewport_only: false。',
        inputSchema: {
            type: 'object',
            properties: {
                tab_id: {
                    type: 'number',
                    description: '可选：指定要在哪个后台标签页上获取快照',
                },
                viewport_only: {
                    type: 'boolean',
                    description: '可选：是否仅返回当前屏幕视口内的元素（默认为 true，推荐保持开启以大幅节省 Token）',
                },
                reveal_hover: {
                    type: 'boolean',
                    description: '可选：是否在快照前执行智能悬停扫描，自动唤醒并透出卡片内的 React/CSS 悬浮操作按钮（如 BOSS直聘简历的「编辑」「添加」「同步」按钮），默认为 true',
                },
                max_elements: {
                    type: 'number',
                    description: '可选：最多返回的元素数量上限（默认为 50）',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_get_text',
        description: '提取目标标签页中指定元素内部的文本，或者在未指定 ID 时获取用户在网页中选中的划词片段。',
        inputSchema: {
            type: 'object',
            properties: {
                snapshot_id: { type: 'string', description: '快照返回的 Snapshot ID，用于拒绝过期操作' },
                element_id: {
                    type: 'number',
                    description: '可选：目标元素的数字编号 ID',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
        },
    },
    // ── 3. 页面交互与控制 ──
    {
        name: 'browser_click',
        description: '点击指定数字编号的网页元素（如按钮、链接、选项卡等）。支持静默在后台/专属窗口中点击。',
        inputSchema: {
            type: 'object',
            properties: {
                snapshot_id: { type: 'string', description: 'Snapshot ID from browser_snapshot; stale revisions are rejected' },
                element_id: {
                    type: 'number',
                    description: '目标元素的编号（由 browser_snapshot 返回的数字 ID，如 1、2 等）',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定在哪个后台标签页中执行点击',
                },
            },
            required: ['element_id'],
        },
    },
    {
        name: 'browser_hover',
        description: '【鼠标悬停/Hover】将光标悬停在指定元素或卡片区域上，用于触发 React/Vue 的 hover 浮层菜单、卡片悬浮操作按钮（如 BOSS直聘在线简历页每一栏的「编辑」「添加」「同步」按钮）或展开下拉菜单。',
        inputSchema: {
            type: 'object',
            properties: {
                snapshot_id: { type: 'string', description: 'Snapshot ID from browser_snapshot; stale revisions are rejected' },
                element_id: {
                    type: 'number',
                    description: '可选：目标元素的编号（由 browser_snapshot 返回的数字 ID）',
                },
                selector: {
                    type: 'string',
                    description: '可选：通过 CSS 选择器定位要悬停的目标容器（如 ".resume-item", ".annex-item"）',
                },
                text: {
                    type: 'string',
                    description: '可选：通过包含的文本查找目标容器（如 "工作经历", "附件简历"）',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定在哪个标签页中执行悬停',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_type',
        description: '在指定数字编号的输入框或文本域中填入文本内容，并自动触发前端事件更新。支持在专属窗口/后台中静默填表。',
        inputSchema: {
            type: 'object',
            properties: {
                snapshot_id: { type: 'string', description: 'Snapshot ID from browser_snapshot; stale revisions are rejected' },
                element_id: {
                    type: 'number',
                    description: '目标输入框的数字编号 ID',
                },
                text: {
                    type: 'string',
                    description: '要输入的文本内容',
                },
                clear_first: {
                    type: 'boolean',
                    description: '是否在输入前先清空已有内容，默认为 true',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定在哪个后台标签页中执行输入',
                },
            },
            required: ['element_id', 'text'],
        },
    },
    {
        name: 'browser_press',
        description: '在目标页面当前焦点元素上触发键盘按键（例如 "Enter", "Tab", "Escape", "Backspace" 等）。',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: '按键名称（如 "Enter"、"Tab"、"ArrowDown" 等）',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
            required: ['key'],
        },
    },
    {
        name: 'browser_scroll',
        description: '控制网页上下滚动或直接跳转至顶部/底部。支持在专属窗口中静默滚动。',
        inputSchema: {
            type: 'object',
            properties: {
                direction: {
                    type: 'string',
                    enum: ['down', 'up', 'top', 'bottom'],
                    description: '滚动方向（down: 向下, up: 向上, top: 顶部, bottom: 底部）',
                },
                amount: {
                    type: 'number',
                    description: '滚动的像素距离（默认为 500px，仅在 down/up 时生效）',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定目标标签页 ID',
                },
            },
            required: ['direction'],
        },
    },
    {
        name: 'browser_navigate',
        description: '后台自主导航：不传 tab_id 时，自动创建 AI 专用窗口或继续在已绑定的 AI 工作页跳转，不覆盖用户窗口。只有明确操作已有页面时才传 tab_id。',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '目标网址（如 "https://www.bing.com"）',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定要在哪个标签页中跳转',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'browser_wait',
        description: '等待指定的时间（秒），用于等待异步请求或页面过渡渲染完成。',
        inputSchema: {
            type: 'object',
            properties: {
                seconds: {
                    type: 'number',
                    description: '等待的秒数（如 2）',
                },
            },
            required: ['seconds'],
        },
    },
    {
        name: 'browser_wait_for',
        description: '【推荐】智能条件等待：毫秒级监听页面 DOM 变化，直到指定的 CSS 选择器或文本内容出现（或消失）时立即返回，告别低效死等。',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: '可选：等待出现的 CSS 选择器（如 ".el-dialog", "#success-tip", "button[type=submit]"）',
                },
                text: {
                    type: 'string',
                    description: '可选：页面中需要出现的关键文字内容（如 "操作成功"、"简历选择"）',
                },
                state: {
                    type: 'string',
                    enum: ['visible', 'hidden'],
                    description: '等待状态，默认为 "visible"（等待元素可见），传 "hidden" 可用于等待加载遮罩消失',
                },
                timeout_seconds: {
                    type: 'number',
                    description: '最长超时等待时间（秒），默认 10 秒，最大支持 60 秒',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定要在哪个标签页中等待',
                },
            },
            required: [],
        },
    },
    {
        name: 'browser_upload_file',
        description: '【全自动文件上传】将本地磁盘中的文件（如简历 PDF、图片、表格等）直接注入目标网页的上传控件中，免弹窗、零人工介入。支持指定 element_id（如"选择文件"按钮编号），若不传则自动匹配弹窗内的上传控件。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: '要上传的本地文件绝对路径（例如 "D:\\ai\\antigravity\\work\\简历\\朱宝乐_个人简历.pdf"）',
                },
                element_id: {
                    type: 'number',
                    description: '可选：页面中"选择文件"按钮或 input 元素的编号（由 browser_snapshot 返回）',
                },
                snapshot_id: {
                    type: 'string',
                    description: '可选：快照 ID，用于确保 DOM 时效性校验',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定要在哪个标签页中上传文件',
                },
            },
            required: ['file_path'],
        },
    },
    {
        name: 'browser_reload_extension',
        description: '【一键/自动热重载扩展】立即重新加载浏览器扩展（执行 chrome.runtime.reload()），免去手动前往 chrome://extensions 页面点击刷新的繁琐步骤。默认自动同步刷新当前受控标签页，使新注入的脚本立即生效。',
        inputSchema: {
            type: 'object',
            properties: {
                reload_tabs: {
                    type: 'boolean',
                    description: '重新加载扩展后是否同时刷新受控网页（使新版脚本立即注入生效），默认为 true',
                },
                tab_id: {
                    type: 'number',
                    description: '可选：指定需要同步刷新的标签页 ID',
                },
            },
            required: [],
        },
    },
];
// 注册工具列表处理器
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
// 注册工具调用执行处理器
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        const tool = TOOLS.find(tool => tool.name === name);
        if (!tool)
            throw new Error('Unknown tool');
        for (const field of (tool.inputSchema.required || [])) {
            if (args?.[field] === undefined)
                throw new Error(`Missing argument: ${field}`);
        }
        const properties = tool.inputSchema.properties || {};
        for (const [key, value] of Object.entries(args || {})) {
            const schema = properties[key];
            if (!schema)
                throw new Error(`Unknown argument: ${key}`);
            if (schema.type === 'array') {
                if (!Array.isArray(value))
                    throw new Error(`Invalid argument type: ${key} (expected array)`);
            }
            else if (schema.type && typeof value !== schema.type) {
                throw new Error(`Invalid argument type: ${key}`);
            }
            if (schema.enum && !schema.enum.includes(value))
                throw new Error(`Invalid argument: ${key}`);
            if (typeof value === 'number' && !Number.isFinite(value))
                throw new Error(`Invalid number: ${key}`);
            if (['tab_id', 'element_id', 'max_elements', 'limit', 'status_code'].includes(key) && (!Number.isInteger(value) || Number(value) < 1))
                throw new Error(`Expected positive integer: ${key}`);
            if (key === 'timeout_seconds' && (typeof value !== 'number' || value <= 0 || value > 120))
                throw new Error('timeout_seconds must be between 0.1 and 120');
            if (typeof value === 'string' && value.length > 100000)
                throw new Error(`Argument too long: ${key}`);
        }
        if (name === 'browser_wait') {
            const seconds = Number(args?.seconds);
            if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30)
                throw new Error('seconds must be between 0 and 30');
            await new Promise((r) => setTimeout(r, seconds * 1000));
            return {
                content: [{ type: 'text', text: `已等待 ${seconds} 秒。` }],
            };
        }
        if (name === 'browser_upload_file') {
            const filePath = String(args?.file_path || '');
            if (!node_fs_1.default.existsSync(filePath)) {
                throw new Error(`本地文件不存在: ${filePath}`);
            }
            const stat = node_fs_1.default.statSync(filePath);
            if (!stat.isFile()) {
                throw new Error(`路径不是一个有效的文件: ${filePath}`);
            }
            if (stat.size > 20 * 1024 * 1024) {
                throw new Error(`文件大小超出限制 (最大支持 20MB): 当前大小 ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
            }
            const filename = node_path_1.default.basename(filePath);
            const ext = node_path_1.default.extname(filePath).toLowerCase();
            const mimeType = MIME_MAP[ext] || 'application/octet-stream';
            const fileBuffer = node_fs_1.default.readFileSync(filePath);
            const base64 = fileBuffer.toString('base64');
            const payload = {
                element_id: args?.element_id,
                filename,
                mimeType,
                base64,
                snapshot_id: args?.snapshot_id,
                tab_id: args?.tab_id
            };
            const result = await bridge.sendCommand('browser_upload_file', payload, 20000);
            return {
                content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]
            };
        }
        // 其它工具全部通过 WebSocket 派发给浏览器扩展执行
        const timeout = name === 'browser_wait_for'
            ? Math.min(65000, ((Number(args?.timeout_seconds) || 10) + 5) * 1000)
            : name === 'browser_wait_for_download'
                ? Math.min(130000, ((Number(args?.timeout_seconds) || 30) + 5) * 1000)
                : 15000;
        const result = await bridge.sendCommand(name, args || {}, timeout);
        let textResult = '';
        if (typeof result === 'string') {
            textResult = result;
        }
        else {
            textResult = JSON.stringify(result, null, 2);
        }
        return {
            content: [{ type: 'text', text: textResult }],
        };
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: 'text', text: `执行错误: ${error.message}` }],
        };
    }
});
// 启动 Stdio 传输层与 Agent 连接
async function main() {
    server.onclose = () => { if (process.env.BRIDGE_DAEMON !== '1')
        bridge.close(); };
    process.once('SIGINT', () => { bridge.close(); process.exit(0); });
    process.once('SIGTERM', () => { bridge.close(); process.exit(0); });
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP-Server] Browser Agent MCP Bridge Server (v1.9.3 Hover Action Revealer & Auto-Reload) started successfully over stdio.');
}
main().catch((err) => {
    console.error('[MCP-Server] Fatal startup error:', err);
    process.exit(1);
});
