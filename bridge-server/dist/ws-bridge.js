"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketBridge = void 0;
// ws-bridge.ts - WebSocket Bridge Server
const ws_1 = require("ws");
const crypto_1 = require("crypto");
class WebSocketBridge {
    wss = null;
    activeClient = null;
    pendingRequests = new Map();
    port;
    constructor(port = 3088) {
        this.port = port;
    }
    /**
     * 启动 WebSocket 服务端
     */
    start() {
        this.wss = new ws_1.WebSocketServer({ port: this.port, host: '127.0.0.1' });
        this.wss.on('connection', (ws) => {
            // 在 MCP 协议中，所有日志必须输出到 stderr，stdout 专用于 MCP 消息
            console.error(`[WS-Bridge] Browser extension connected on port ${this.port}`);
            this.activeClient = ws;
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    // 忽略心跳保活包
                    if (msg.type === 'PING') {
                        ws.send(JSON.stringify({ type: 'PONG' }));
                        return;
                    }
                    const response = msg;
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
                    console.error('[WS-Bridge] Failed to parse message from extension:', err.message);
                }
            });
            ws.on('close', () => {
                console.error('[WS-Bridge] Browser extension disconnected');
                if (this.activeClient === ws) {
                    this.activeClient = null;
                }
                // 清理所有等待中的请求
                for (const [id, pending] of this.pendingRequests) {
                    clearTimeout(pending.timer);
                    pending.reject(new Error('浏览器插件连接已断开'));
                }
                this.pendingRequests.clear();
            });
            ws.on('error', (err) => {
                console.error('[WS-Bridge] WebSocket client error:', err.message);
            });
        });
        this.wss.on('error', (err) => {
            console.error(`[WS-Bridge] Server error on port ${this.port}:`, err.message);
        });
        console.error(`[WS-Bridge] WebSocket Server listening at ws://127.0.0.1:${this.port}/ws`);
    }
    /**
     * 向浏览器扩展发送指令并等待结果
     */
    async sendCommand(method, params = {}, timeoutMs = 15000) {
        if (!this.activeClient || this.activeClient.readyState !== ws_1.WebSocket.OPEN) {
            throw new Error('未检测到已连接的浏览器扩展！请确保：\n' +
                '1. Edge 或 Chrome 浏览器已打开，且已加载 Browser Agent 扩展；\n' +
                '2. 扩展侧边栏或后台连接状态显示已连接 (绿色)。');
        }
        const id = (0, crypto_1.randomUUID)();
        const request = { id, method, params };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`指令执行超时 (${timeoutMs}ms): ${method}`));
            }, timeoutMs);
            this.pendingRequests.set(id, { resolve, reject, timer });
            try {
                this.activeClient.send(JSON.stringify(request));
            }
            catch (err) {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(new Error(`发送指令失败: ${err.message}`));
            }
        });
    }
    /**
     * 关闭服务
     */
    close() {
        if (this.wss) {
            this.wss.close();
        }
    }
}
exports.WebSocketBridge = WebSocketBridge;
