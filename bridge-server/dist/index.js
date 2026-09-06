"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// index.ts - Main MCP Server Entry (Multi-Tab & Background Automation)
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const ws_bridge_1 = require("./ws-bridge");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const port = parseInt(process.env.BRIDGE_PORT || '3088', 10);
const bridge = new ws_bridge_1.WebSocketBridge(port);
bridge.start();
// 创建 MCP Server 实例
const server = new index_js_1.Server({
    name: 'browser-agent-bridge',
    version: '1.1.0',
}, {
    capabilities: {
        tools: {},
    },
});
// 定义暴露给 AI 的标准浏览器操作工具集
const TOOLS = [
    // ── 1. 标签页发现与多任务管理 ──
    {
        name: 'browser_list_tabs',
        description: '获取当前浏览器中所有已打开的标签页列表（包含每个标签页的 ID、标题、URL、是否处于活动状态、是否已被锁定为后台工作区）。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'browser_create_tab',
        description: '在浏览器中创建一个全新的网页标签页。默认在后台静默打开（不抢占用户前台屏幕），并自动锁定为 AI 的专属后台工作区。',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要打开的目标网址（如 "https://www.bing.com"）',
                },
                active: {
                    type: 'boolean',
                    description: '是否直接切换到前台显示，默认为 false（即在后台静默运行，不打扰用户）',
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
    // ── 2. 页面感知与信息提取 ──
    {
        name: 'browser_get_active_tab',
        description: '获取当前受控标签页（优先返回锁定的后台标签页，若未锁定则返回前台活动标签页）的 URL、标题和运行模式。',
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
        description: '获取目标网页的结构化纯文本快照（包含带有 [1], [2] 等数字编号的交互元素，如按钮、输入框、链接等）。支持指定后台 tab_id，在执行点击、输入前必须先调用此工具获取最新的元素编号。',
        inputSchema: {
            type: 'object',
            properties: {
                tab_id: {
                    type: 'number',
                    description: '可选：指定要在哪个后台标签页上获取快照',
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
        description: '点击指定数字编号的网页元素（如按钮、链接、选项卡等）。支持静默在后台标签页中点击。',
        inputSchema: {
            type: 'object',
            properties: {
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
        name: 'browser_type',
        description: '在指定数字编号的输入框或文本域中填入文本内容，并自动触发前端事件更新。支持在后台标签页中静默填表。',
        inputSchema: {
            type: 'object',
            properties: {
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
        description: '控制网页上下滚动或直接跳转至顶部/底部。支持在后台标签页中静默滚动。',
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
        description: '在受控标签页中导航跳转至指定的网址 URL。',
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
];
// 注册工具列表处理器
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
// 注册工具调用执行处理器
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === 'browser_wait') {
            const seconds = args?.seconds || 1;
            await new Promise((r) => setTimeout(r, seconds * 1000));
            return {
                content: [{ type: 'text', text: `已等待 ${seconds} 秒。` }],
            };
        }
        // 其它工具全部通过 WebSocket 派发给浏览器扩展执行
        const result = await bridge.sendCommand(name, args || {});
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
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP-Server] Browser Agent MCP Bridge Server (v1.1.0 Multi-Tab) started successfully over stdio.');
}
main().catch((err) => {
    console.error('[MCP-Server] Fatal startup error:', err);
    process.exit(1);
});
