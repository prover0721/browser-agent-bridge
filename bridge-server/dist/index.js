"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// index.ts - Main MCP Server Entry
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
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// 定义暴露给 AI 的标准浏览器操作工具集
const TOOLS = [
    {
        name: 'browser_get_active_tab',
        description: '获取当前用户正在浏览的活动网页标签页的 URL、标题和基础信息。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'browser_snapshot',
        description: '获取当前网页的结构化纯文本快照（包含带有 [1], [2] 等数字编号的交互元素，如按钮、输入框、链接等）。在对网页执行点击、输入前必须先调用此工具获取最新的元素编号。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'browser_click',
        description: '点击指定数字编号的网页元素（如按钮、链接、选项卡等）。',
        inputSchema: {
            type: 'object',
            properties: {
                element_id: {
                    type: 'number',
                    description: '目标元素的编号（由 browser_snapshot 返回的数字 ID，如 1、2 等）',
                },
            },
            required: ['element_id'],
        },
    },
    {
        name: 'browser_type',
        description: '在指定数字编号的输入框或文本域中填入文本内容，并自动触发前端事件更新。',
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
            },
            required: ['element_id', 'text'],
        },
    },
    {
        name: 'browser_press',
        description: '在当前焦点元素上触发键盘按键（例如 "Enter", "Tab", "Escape", "Backspace" 等）。',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: '按键名称（如 "Enter"、"Tab"、"ArrowDown" 等）',
                },
            },
            required: ['key'],
        },
    },
    {
        name: 'browser_scroll',
        description: '控制当前网页上下滚动或直接跳转至顶部/底部。',
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
            },
            required: ['direction'],
        },
    },
    {
        name: 'browser_navigate',
        description: '在当前受控标签页中导航跳转至指定的网址 URL。',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '目标网址（如 "https://www.bing.com"）',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'browser_get_text',
        description: '提取指定元素内部的文本，或者在未指定 ID 时获取用户在网页中选中的划词片段。',
        inputSchema: {
            type: 'object',
            properties: {
                element_id: {
                    type: 'number',
                    description: '可选：目标元素的数字编号 ID',
                },
            },
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
    console.error('[MCP-Server] Browser Agent MCP Bridge Server started successfully over stdio.');
}
main().catch((err) => {
    console.error('[MCP-Server] Fatal startup error:', err);
    process.exit(1);
});
