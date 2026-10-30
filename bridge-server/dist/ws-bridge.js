"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketBridge = void 0;
const ws_1 = require("ws");
const node_crypto_1 = require("node:crypto");
const METHODS = new Set(['browser_create_window', 'browser_close_window', 'browser_create_tab', 'browser_list_tabs', 'browser_bind_tab', 'browser_unbind_tab', 'browser_switch_tab', 'browser_close_tab', 'browser_get_active_tab', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_hover', 'browser_press', 'browser_scroll', 'browser_navigate', 'browser_get_text', 'browser_wait_for', 'browser_upload_file', 'browser_list_bookmarks', 'browser_open_bookmark', 'browser_get_cookies', 'browser_get_storage', 'browser_evaluate', 'browser_wait_for_download', 'browser_get_downloads', 'browser_get_network_logs', 'browser_fill_form', 'browser_go_back', 'browser_go_forward', 'browser_reload', 'browser_reload_extension', 'browser_insert_text']);
class WebSocketBridge {
    port;
    wss = null;
    browserClient = null;
    relayWs = null;
    pendingRequests = new Map();
    routes = new Map();
    reconnectTimer = null;
    isMaster = false;
    isClosing = false;
    sessionId = (0, node_crypto_1.randomUUID)();
    constructor(port = 3088) {
        this.port = port;
        if (!Number.isInteger(port) || port < 1 || port > 65535)
            throw new Error('Invalid BRIDGE_PORT');
    }
    start() {
        const server = new ws_1.WebSocketServer({
            port: this.port, host: '127.0.0.1', maxPayload: 1024 * 1024,
            verifyClient: ({ req }) => {
                const path = req.url || '';
                const origin = req.headers.origin;
                // Browser pages cannot use either endpoint. Extension origins are allowed only on /ws.
                const validOrigin = path === '/agent' ? !origin : !!origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
                return (path === '/agent' || path === '/ws') && validOrigin;
            }
        });
        this.wss = server;
        server.on('listening', () => { this.isMaster = true; console.error(`[WS-Bridge] Listening on 127.0.0.1:${this.port}`); });
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                this.wss = null;
                server.close();
                this.connectAsRelay();
            }
            else
                console.error('[WS-Bridge] Server error:', error.message);
        });
        server.on('connection', (ws, req) => {
            if (req.url === '/agent') {
                const sessionId = (0, node_crypto_1.randomUUID)();
                ws.on('message', data => {
                    let msg;
                    try {
                        msg = JSON.parse(data.toString());
                        if (msg.type === 'PING') {
                            ws.send(JSON.stringify({ type: 'PONG' }));
                            return;
                        }
                        if (typeof msg.id !== 'string' || !METHODS.has(msg.method) || !msg.params || typeof msg.params !== 'object' || Array.isArray(msg.params))
                            throw new Error('Invalid command');
                        if (!this.browserClient || this.browserClient.readyState !== ws_1.WebSocket.OPEN)
                            throw new Error('Browser extension is not connected');
                        if (this.routes.size >= 1000)
                            throw new Error('Too many pending commands');
                        const id = (0, node_crypto_1.randomUUID)(); // Never trust IDs or session identities supplied by a relay.
                        const timeout = Math.min(65000, ((Number(msg.params?.timeout_seconds) || 10) + 5) * 1000);
                        const timer = setTimeout(() => {
                            this.routes.delete(id);
                            if (ws.readyState === ws_1.WebSocket.OPEN)
                                ws.send(JSON.stringify({ id: msg.id, error: 'Browser command timed out' }));
                        }, timeout);
                        this.routes.set(id, { client: ws, originalId: msg.id, timer });
                        this.browserClient.send(JSON.stringify({ id, method: msg.method, params: msg.params, session_id: sessionId, expires_at: Date.now() + timeout - 1000 }));
                    }
                    catch (error) {
                        if (typeof msg?.id === 'string')
                            ws.send(JSON.stringify({ id: msg.id, error: error.message }));
                    }
                });
                ws.on('close', () => { for (const [id, route] of this.routes)
                    if (route.client === ws) {
                        clearTimeout(route.timer);
                        this.routes.delete(id);
                    } });
            }
            else {
                if (this.browserClient?.readyState === ws_1.WebSocket.OPEN) {
                    ws.close(1008, 'Browser already connected');
                    return;
                }
                this.browserClient = ws;
                ws.on('message', data => {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.type === 'PING') {
                            ws.send(JSON.stringify({ type: 'PONG' }));
                            return;
                        }
                        const route = this.routes.get(msg.id);
                        if (route) {
                            clearTimeout(route.timer);
                            this.routes.delete(msg.id);
                            if (route.client.readyState === ws_1.WebSocket.OPEN)
                                route.client.send(JSON.stringify({ ...msg, id: route.originalId }));
                        }
                        else
                            this.settle(msg);
                    }
                    catch {
                        console.error('[WS-Bridge] Invalid browser response');
                    }
                });
                ws.on('close', () => {
                    if (this.browserClient !== ws)
                        return;
                    this.browserClient = null;
                    this.rejectPending('Browser extension disconnected');
                    for (const route of this.routes.values()) {
                        clearTimeout(route.timer);
                        if (route.client.readyState === ws_1.WebSocket.OPEN)
                            route.client.send(JSON.stringify({ id: route.originalId, error: 'Browser extension disconnected' }));
                    }
                    this.routes.clear();
                });
            }
            ws.on('error', () => { });
        });
    }
    settle(msg) {
        const pending = this.pendingRequests.get(msg.id);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.error)
            pending.reject(new Error(String(msg.error)));
        else
            pending.resolve(msg.result);
    }
    rejectPending(message) {
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(message));
        }
        this.pendingRequests.clear();
    }
    connectAsRelay() {
        if (this.isClosing)
            return;
        const ws = new ws_1.WebSocket(`ws://127.0.0.1:${this.port}/agent`, { maxPayload: 1024 * 1024 });
        this.relayWs = ws;
        ws.on('message', data => { try {
            this.settle(JSON.parse(data.toString()));
        }
        catch { } });
        ws.on('error', () => { });
        ws.on('close', () => {
            this.rejectPending('Master bridge disconnected');
            if (!this.isClosing)
                this.reconnectTimer = setTimeout(() => this.connectAsRelay(), 3000);
        });
    }
    broadcastHotReload() {
        if (this.browserClient && this.browserClient.readyState === ws_1.WebSocket.OPEN) {
            try {
                this.browserClient.send(JSON.stringify({ type: 'HOT_RELOAD_EXTENSION' }));
            }
            catch (e) {
                console.error('[WS-Bridge] Failed to send hot-reload signal:', e.message);
            }
        }
    }
    async sendCommand(method, params = {}, timeoutMs = 15000) {
        if (!METHODS.has(method))
            throw new Error('Unknown browser command');
        const client = this.isMaster ? this.browserClient : this.relayWs;
        if (!client || client.readyState !== ws_1.WebSocket.OPEN)
            throw new Error('Browser bridge is not connected');
        const id = (0, node_crypto_1.randomUUID)();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pendingRequests.delete(id); reject(new Error(`Command timed out: ${method}`)); }, timeoutMs);
            this.pendingRequests.set(id, { resolve, reject, timer });
            client.send(JSON.stringify({ id, method, params, session_id: this.sessionId, expires_at: Date.now() + timeoutMs - 500 }), error => {
                if (error)
                    this.settle({ id, error: error.message });
            });
        });
    }
    close() {
        this.isClosing = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.rejectPending('Bridge closed');
        for (const route of this.routes.values())
            clearTimeout(route.timer);
        this.routes.clear();
        this.relayWs?.terminate();
        this.wss?.clients.forEach(ws => ws.terminate());
        this.wss?.close();
    }
}
exports.WebSocketBridge = WebSocketBridge;
