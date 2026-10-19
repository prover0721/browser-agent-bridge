import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { WebSocketBridge } from '../src/ws-bridge';

const origin = 'chrome-extension://' + 'a'.repeat(32);
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as any).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
function connect(port: number, path: string, pageOrigin?: string) {
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin: pageOrigin });
}
async function start() {
  const port = await freePort(); const bridge = new WebSocketBridge(port); bridge.start();
  await once((bridge as any).wss, 'listening'); return { port, bridge };
}

test('connects without pairing and rejects webpage origins, invalid paths, and duplicate browsers', async () => {
  const { port, bridge } = await start();
  try {
    for (const [path, pageOrigin] of [['/agent', 'https://evil.example'], ['/ws', 'https://evil.example'], ['/agent-extra', undefined]]) {
      const ws = connect(port, path!, pageOrigin);
      await once(ws, 'error'); ws.terminate();
    }
    const browser = connect(port, '/ws', origin); await once(browser, 'open');
    const duplicate = connect(port, '/ws', origin);
    const closed = once(duplicate, 'close'); await once(duplicate, 'open');
    assert.equal((await closed)[0], 1008);
  } finally { bridge.close(); }
});

test('relay IDs and sessions are isolated; disconnect rejects outstanding requests', async () => {
  const { port, bridge } = await start();
  try {
    const browser = connect(port, '/ws', origin); await once(browser, 'open');
    const a = connect(port, '/agent'); const b = connect(port, '/agent');
    await Promise.all([once(a, 'open'), once(b, 'open')]);
    const requests: any[] = [];
    browser.on('message', data => {
      const request = JSON.parse(data.toString()); requests.push(request);
      browser.send(JSON.stringify({ id: request.id, result: request.session_id }));
    });
    const ra = once(a, 'message'); const rb = once(b, 'message');
    const command = JSON.stringify({ id: 'same-id', method: 'browser_list_tabs', params: {}, session_id: 'spoofed' });
    a.send(command); b.send(command);
    const [first, second] = await Promise.all([ra, rb]);
    assert.notEqual(JSON.parse(first[0].toString()).result, JSON.parse(second[0].toString()).result);
    assert.notEqual(requests[0].id, requests[1].id);
    browser.removeAllListeners('message');
    const pending = bridge.sendCommand('browser_list_tabs');
    const rejected = assert.rejects(pending, /disconnected/);
    browser.close(); await rejected;
  } finally { bridge.close(); }
});
