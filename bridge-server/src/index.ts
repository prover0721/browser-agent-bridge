// index.ts - Main MCP Server Entry (v1.2.0 Dedicated Window Isolation)
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketBridge } from './ws-bridge';
import dotenv from 'dotenv';

dotenv.config();

const port = Number(process.env.BRIDGE_PORT || '3088');
const bridge = new WebSocketBridge(port);
bridge.start();

// 创建 MCP Server 实例
const server = new Server(
  {
    name: 'browser-agent-bridge',
    version: '1.4.2',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 定义暴露给 AI 的标准浏览器操作工具集
const TOOLS: Tool[] = [
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
    description:
      '切换 AI 受控标签页，默认不改变前台显示。有工作窗口时，关键词默认只搜索该窗口。仅在用户要求展示结果时传 focused: true。',
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
    description:
      '获取目标网页的结构化纯文本快照（包含带有 [1], [2] 等数字编号的交互元素，如按钮、输入框、链接等）。已内置【视口优先（In-Viewport）智能降噪与 Token 瘦身】，默认只返回当前屏幕可见范围内的核心元素并附带滚动位置指示，极度节省 Token。若需查看全页元素，可传 viewport_only: false。',
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
];

// 注册工具列表处理器
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// 注册工具调用执行处理器
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const tool = TOOLS.find(tool => tool.name === name);
    if (!tool) throw new Error('Unknown tool');
    for (const field of (tool.inputSchema.required || [])) {
      if (args?.[field] === undefined) throw new Error(`Missing argument: ${field}`);
    }
    const properties = tool.inputSchema.properties || {};
    for (const [key, value] of Object.entries(args || {})) {
      const schema = properties[key] as { type?: string; enum?: unknown[] } | undefined;
      if (!schema) throw new Error(`Unknown argument: ${key}`);
      if (schema.type && typeof value !== schema.type) throw new Error(`Invalid argument type: ${key}`);
      if (schema.enum && !schema.enum.includes(value)) throw new Error(`Invalid argument: ${key}`);
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Invalid number: ${key}`);
      if (['tab_id', 'element_id', 'max_elements'].includes(key) && (!Number.isInteger(value) || Number(value) < 1)) throw new Error(`Expected positive integer: ${key}`);
      if (typeof value === 'string' && value.length > 100000) throw new Error(`Argument too long: ${key}`);
    }
    if (name === 'browser_wait') {
      const seconds = Number(args?.seconds);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) throw new Error('seconds must be between 0 and 30');
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return {
        content: [{ type: 'text', text: `已等待 ${seconds} 秒。` }],
      };
    }

    // 其它工具全部通过 WebSocket 派发给浏览器扩展执行
    const result = await bridge.sendCommand(name, (args as Record<string, any>) || {});
    
    let textResult = '';
    if (typeof result === 'string') {
      textResult = result;
    } else {
      textResult = JSON.stringify(result, null, 2);
    }

    return {
      content: [{ type: 'text', text: textResult }],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: 'text', text: `执行错误: ${error.message}` }],
    };
  }
});

// 启动 Stdio 传输层与 Agent 连接
async function main() {
  server.onclose = () => { if (process.env.BRIDGE_DAEMON !== '1') bridge.close(); };
  process.once('SIGINT', () => { bridge.close(); process.exit(0); });
  process.once('SIGTERM', () => { bridge.close(); process.exit(0); });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP-Server] Browser Agent MCP Bridge Server (v1.4.2 Automatic Connection & Reliability) started successfully over stdio.');
}

main().catch((err) => {
  console.error('[MCP-Server] Fatal startup error:', err);
  process.exit(1);
});

