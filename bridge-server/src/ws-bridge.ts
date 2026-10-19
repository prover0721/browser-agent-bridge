import { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { PendingRequest } from './types';

const METHODS = new Set(['browser_create_window', 'browser_close_window', 'browser_create_tab', 'browser_list_tabs', 'browser_bind_tab', 'browser_unbind_tab', 'browser_switch_tab', 'browser_close_tab', 'browser_get_active_tab', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_press', 'browser_scroll', 'browser_navigate', 'browser_get_text']);

export class WebSocketBridge {
  private wss: WebSocketServer | null = null;
  private browserClient: WebSocket | null = null;
  private relayWs: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private routes = new Map<string, { client: WebSocket; originalId: string; timer: NodeJS.Timeout }>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isMaster = false;
  private isClosing = false;
  private sessionId = randomUUID();

  constructor(private port = 3088) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid BRIDGE_PORT');
  }

  public start(): void {
    const server = new WebSocketServer({
      port: this.port, host: '127.0.0.1', maxPayload: 1024 * 1024,
      verifyClient: ({ req }: { req: IncomingMessage }) => {
        const path = req.url || '';
        const origin = req.headers.origin;
        // Browser pages cannot use either endpoint. Extension origins are allowed only on /ws.
        const validOrigin = path === '/agent' ? !origin : !!origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
        return (path === '/agent' || path === '/ws') && validOrigin;
      }
    });
    this.wss = server;
    server.on('listening', () => { this.isMaster = true; console.error(`[WS-Bridge] Listening on 127.0.0.1:${this.port}`); });
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') { this.wss = null; server.close(); this.connectAsRelay(); }
      else console.error('[WS-Bridge] Server error:', error.message);
    });
    server.on('connection', (ws, req) => {
      if (req.url === '/agent') {
        const sessionId = randomUUID();
        ws.on('message', data => {
          let msg: any;
          try {
            msg = JSON.parse(data.toString());
            if (msg.type === 'PING') { ws.send(JSON.stringify({ type: 'PONG' })); return; }
            if (typeof msg.id !== 'string' || !METHODS.has(msg.method) || !msg.params || typeof msg.params !== 'object' || Array.isArray(msg.params)) throw new Error('Invalid command');
            if (!this.browserClient || this.browserClient.readyState !== WebSocket.OPEN) throw new Error('Browser extension is not connected');
            if (this.routes.size >= 1000) throw new Error('Too many pending commands');
            const id = randomUUID(); // Never trust IDs or session identities supplied by a relay.
            const timer = setTimeout(() => {
              this.routes.delete(id);
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: msg.id, error: 'Browser command timed out' }));
            }, 15000);
            this.routes.set(id, { client: ws, originalId: msg.id, timer });
            this.browserClient.send(JSON.stringify({ id, method: msg.method, params: msg.params, session_id: sessionId, expires_at: Date.now() + 14000 }));
          } catch (error: any) {
            if (typeof msg?.id === 'string') ws.send(JSON.stringify({ id: msg.id, error: error.message }));
          }
        });
        ws.on('close', () => { for (const [id, route] of this.routes) if (route.client === ws) { clearTimeout(route.timer); this.routes.delete(id); } });
      } else {
        if (this.browserClient?.readyState === WebSocket.OPEN) { ws.close(1008, 'Browser already connected'); return; }
        this.browserClient = ws;
        ws.on('message', data => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'PING') { ws.send(JSON.stringify({ type: 'PONG' })); return; }
            const route = this.routes.get(msg.id);
            if (route) {
              clearTimeout(route.timer); this.routes.delete(msg.id);
              if (route.client.readyState === WebSocket.OPEN) route.client.send(JSON.stringify({ ...msg, id: route.originalId }));
            } else this.settle(msg);
          } catch { console.error('[WS-Bridge] Invalid browser response'); }
        });
        ws.on('close', () => {
          if (this.browserClient !== ws) return;
          this.browserClient = null;
          this.rejectPending('Browser extension disconnected');
          for (const route of this.routes.values()) {
            clearTimeout(route.timer);
            if (route.client.readyState === WebSocket.OPEN) route.client.send(JSON.stringify({ id: route.originalId, error: 'Browser extension disconnected' }));
          }
          this.routes.clear();
        });
      }
      ws.on('error', () => {});
    });
  }

  private settle(msg: any): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pendingRequests.delete(msg.id);
    if (msg.error) pending.reject(new Error(String(msg.error))); else pending.resolve(msg.result);
  }
  private rejectPending(message: string): void {
    for (const pending of this.pendingRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pendingRequests.clear();
  }
  private connectAsRelay(): void {
    if (this.isClosing) return;
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}/agent`, { maxPayload: 1024 * 1024 });
    this.relayWs = ws;
    ws.on('message', data => { try { this.settle(JSON.parse(data.toString())); } catch {} });
    ws.on('error', () => {});
    ws.on('close', () => {
      this.rejectPending('Master bridge disconnected');
      if (!this.isClosing) this.reconnectTimer = setTimeout(() => this.connectAsRelay(), 3000);
    });
  }
  public async sendCommand(method: string, params: Record<string, any> = {}, timeoutMs = 15000): Promise<any> {
    if (!METHODS.has(method)) throw new Error('Unknown browser command');
    const client = this.isMaster ? this.browserClient : this.relayWs;
    if (!client || client.readyState !== WebSocket.OPEN) throw new Error('Browser bridge is not connected');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingRequests.delete(id); reject(new Error(`Command timed out: ${method}`)); }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      client.send(JSON.stringify({ id, method, params, session_id: this.sessionId, expires_at: Date.now() + timeoutMs - 500 }), error => {
        if (error) this.settle({ id, error: error.message });
      });
    });
  }
  public close(): void {
    this.isClosing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.rejectPending('Bridge closed');
    for (const route of this.routes.values()) clearTimeout(route.timer);
    this.routes.clear();
    this.relayWs?.terminate();
    this.wss?.clients.forEach(ws => ws.terminate());
    this.wss?.close();
  }
}
