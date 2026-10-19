"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketBridge = void 0;
// ws-bridge.ts - Dual-Mode (Master / Relay) WebSocket Bridge Server
const ws_1 = require("ws");
const crypto_1 = require("crypto");
class WebSocketBridge {
    wss = null;
    browserClient = null;
    agentClients = new Set();
    relayRequestOrigins = new Map();
    pendingRequests = new Map();
    port;
    isMaster = false;
    relayWs = null;
    reconnectTimer = null;
    isClosing = false;
    constructor(port = 3088) {
        this.port = port;
    }
    /**
     * 启动服务（尝试以 Master 模式绑定端口；若已被占用则自动作为 Relay Client 接入）
     */
    start() {
        try {
            const server = new ws_1.WebSocketServer({ port: this.port, host: '127.0.0.1' });
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`[WS-Bridge] 端口 ${this.port} 已被占用，自动切换为 Agent 中继客户端模式 (Relay Mode)...`);
                    this.isMaster = false;
                    try {
                        server.close();
                    }
                    catch { }
                    this.wss = null;
                    this.connectAsRelay();
                }
                else {
                    console.error(`[WS-Bridge] 服务端发生错误:`, err.message);
                }
            });
            server.on('listening', () => {
                this.isMaster = true;
                this.wss = server;
                console.error(`[WS-Bridge] WebSocket Server 作为主服务 (Master) 成功监听 ws://127.0.0.1:${this.port}/ws`);
            });
            server.on('connection', (ws, req) => {
                const url = req.url || '';
                // 如果是外部 Agent 接入中继
                if (url.startsWith('/agent')) {
                    console.error(`[WS-Bridge] 外部 Agent 客户端已接入共享中继通道`);
                    this.agentClients.add(ws);
                    ws.on('message', (data) => {
                        try {
                            const msg = JSON.parse(data.toString());
                            if (msg.type === 'PING') {
                                ws.send(JSON.stringify({ type: 'PONG' }));
                                return;
                            }
                            // 收到外部 Agent 发送的浏览器控制指令，转发给浏览器扩展
                            if (msg.id && msg.method) {
                                if (this.browserClient && this.browserClient.readyState === ws_1.WebSocket.OPEN) {
                                    this.relayRequestOrigins.set(msg.id, ws);
                                    this.browserClient.send(data.toString());
                                }
                                else {
                                    ws.send(JSON.stringify({
                                        id: msg.id,
                                        error: '未检测到已连接的浏览器扩展！请确保：\n' +
                                            '1. Edge 或 Chrome 浏览器已打开，且已加载 Browser Agent 扩展；\n' +
                                            '2. 扩展侧边栏或后台连接状态显示已连接 (绿色)。'
                                    }));
                                }
                            }
                        }
                        catch (err) {
                            console.error('[WS-Bridge] 解析 Agent 消息失败:', err.message);
                        }
                    });
                    ws.on('close', () => {
                        this.agentClients.delete(ws);
                        // 清理与该 Agent 关联的未完成请求
                        for (const [id, client] of this.relayRequestOrigins.entries()) {
                            if (client === ws) {
                                this.relayRequestOrigins.delete(id);
                            }
                        }
                    });
                    ws.on('error', () => {
                        this.agentClients.delete(ws);
                    });
                    return;
                }
                // 默认连接：浏览器扩展 (Browser Extension)
                console.error(`[WS-Bridge] 浏览器扩展 (Browser Extension) 已接入主服务`);
                this.browserClient = ws;
                ws.on('message', (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.type === 'PING') {
                            ws.send(JSON.stringify({ type: 'PONG' }));
                            return;
                        }
                        const response = msg;
                        // 1. 如果该请求来自于某个外部 Agent
                        const originAgent = this.relayRequestOrigins.get(response.id);
                        if (originAgent) {
                            this.relayRequestOrigins.delete(response.id);
                            if (originAgent.readyState === ws_1.WebSocket.OPEN) {
                                originAgent.send(JSON.stringify(response));
                            }
                            return;
                        }
                        // 2. 如果该请求来自于 Master 自身的 MCP 工具调用
                        const pending = this.pendingRequests.get(response.id);
                        if (pending) {
                            clearTimeout(pending.timer);
                            this.pendingRequests.delete(response.id);
                            if (response.error) {
                                pending.reject(new Error(response.error));
                            }
                            else {
                                pending.resolve(response.result);
                            }
                        }
                    }
                    catch (err) {
                        console.error('[WS-Bridge] 解析扩展回传消息失败:', err.message);
                    }
                });
                ws.on('close', () => {
                    console.error('[WS-Bridge] 浏览器扩展已断开连接');
                    if (this.browserClient === ws) {
                        this.browserClient = null;
                    }
                    // 通知当前所有 pending 请求
                    for (const [id, pending] of this.pendingRequests) {
                        clearTimeout(pending.timer);
                        pending.reject(new Error('浏览器插件连接已断开'));
                    }
                    this.pendingRequests.clear();
                });
                ws.on('error', (err) => {
                    console.error('[WS-Bridge] 浏览器扩展连接异常:', err.message);
                });
            });
        }
        catch (err) {
            console.error(`[WS-Bridge] 创建服务监听失败:`, err.message);
            this.connectAsRelay();
        }
    }
    /**
     * 作为 Relay Client 连接到已存在的主服务
     */
    connectAsRelay() {
        if (this.isClosing)
            return;
        try {
            const ws = new ws_1.WebSocket(`ws://127.0.0.1:${this.port}/agent`);
            this.relayWs = ws;
            ws.on('open', () => {
                console.error(`[WS-Bridge] 成功连接到本地主桥接服务 (ws://127.0.0.1:${this.port}/agent)`);
            });
            ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());
                    if (response.id) {
                        const pending = this.pendingRequests.get(response.id);
                        if (pending) {
                            clearTimeout(pending.timer);
                            this.pendingRequests.delete(response.id);
                            if (response.error) {
                                pending.reject(new Error(response.error));
                            }
                            else {
                                pending.resolve(response.result);
                            }
                        }
                    }
                }
                catch (e) {
                    console.error('[WS-Bridge] 中继消息解析失败:', e.message);
                }
            });
            ws.on('close', () => {
                if (!this.isClosing) {
                    console.error('[WS-Bridge] 与本地主桥接服务断开连接，将在 3 秒后尝试重连...');
                    this.scheduleReconnect();
                }
            });
            ws.on('error', (err) => {
                console.error('[WS-Bridge] 中继客户端连接错误:', err.message);
            });
        }
        catch (e) {
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.connectAsRelay();
        }, 3000);
    }
    /**
     * 向浏览器扩展发送指令并等待结果
     */
    async sendCommand(method, params = {}, timeoutMs = 15000) {
        const id = (0, crypto_1.randomUUID)();
        const request = { id, method, params };
        if (this.isMaster) {
            if (!this.browserClient || this.browserClient.readyState !== ws_1.WebSocket.OPEN) {
                throw new Error('未检测到已连接的浏览器扩展！请确保：\n' +
                    '1. Edge 或 Chrome 浏览器已打开，且已加载 Browser Agent 扩展；\n' +
                    '2. 扩展侧边栏或后台连接状态显示已连接 (绿色)。');
            }
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pendingRequests.delete(id);
                    reject(new Error(`指令执行超时 (${timeoutMs}ms): ${method}`));
                }, timeoutMs);
                this.pendingRequests.set(id, { resolve, reject, timer });
                try {
                    this.browserClient.send(JSON.stringify(request));
                }
                catch (err) {
                    clearTimeout(timer);
                    this.pendingRequests.delete(id);
                    reject(new Error(`发送指令失败: ${err.message}`));
                }
            });
        }
        else {
            // 中继模式 (Relay Mode)
            if (!this.relayWs || this.relayWs.readyState !== ws_1.WebSocket.OPEN) {
                throw new Error(`尚未连接到本地主桥接服务 (端口 ${this.port})！请确保主桥接服务或后台程序正在运行。`);
            }
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pendingRequests.delete(id);
                    reject(new Error(`指令执行超时 (${timeoutMs}ms): ${method}`));
                }, timeoutMs);
                this.pendingRequests.set(id, { resolve, reject, timer });
                try {
                    this.relayWs.send(JSON.stringify(request));
                }
                catch (err) {
                    clearTimeout(timer);
                    this.pendingRequests.delete(id);
                    reject(new Error(`通过中继发送指令失败: ${err.message}`));
                }
            });
        }
    }
    /**
     * 关闭服务
     */
    close() {
        this.isClosing = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        if (this.relayWs) {
            try {
                this.relayWs.close();
            }
            catch { }
            this.relayWs = null;
        }
        if (this.wss) {
            try {
                this.wss.close();
            }
            catch { }
            this.wss = null;
        }
    }
}
exports.WebSocketBridge = WebSocketBridge;
