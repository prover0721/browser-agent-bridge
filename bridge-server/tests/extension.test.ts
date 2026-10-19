import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const root = new URL('../../', import.meta.url);
function content(html: string) {
  const dom = new JSDOM(html, { url: 'https://example.com', runScripts: 'outside-only' });
  const window = dom.window as any;
  let listener: any;
  window.chrome = { runtime: { onMessage: { addListener(fn: any) { listener = fn; } }, sendMessage: () => Promise.resolve() } };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return window.document.body; } });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 1, top: 1, right: 100, bottom: 30, width: 99, height: 29 });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.eval(readFileSync(new URL('browser-extension/content.js', root), 'utf8'));
  return { window, call(action: string, payload = {}): any { let response; listener({ action, payload }, {}, (value: any) => response = value); return response; } };
}

test('textarea input uses textarea setter and never echoes credentials', () => {
  const page = content('<textarea name="password"></textarea>');
  const snapshot = page.call('SNAPSHOT').data;
  const id = Number(snapshot.match(/\[(\d+)\] TEXTAREA/)[1]);
  const result = page.call('TYPE', { id, text: 'super-secret' });
  assert.equal(result.success, true);
  assert.equal(page.window.document.querySelector('textarea').value, 'super-secret');
  assert.ok(!JSON.stringify(result).includes('super-secret'));
  assert.ok(!page.call('SNAPSHOT').data.includes('super-secret'));
});

test('old element IDs and snapshot revisions cannot click a different element', () => {
  const page = content('<button>First</button>');
  const snapshot = page.call('SNAPSHOT').data;
  const id = Number(snapshot.match(/\[(\d+)\] BUTTON/)[1]);
  const revision = snapshot.match(/\[Snapshot\]: (.+)/)[1];
  page.window.document.body.innerHTML = '<button>Second</button>';
  page.call('SNAPSHOT');
  assert.equal(page.call('CLICK', { id }).success, false);
  assert.equal(page.call('CLICK', { id: id + 1, snapshot_id: revision }).success, false);
});

test('disabled and detached elements fail; full snapshot respects limit', () => {
  const page = content('<button disabled>Disabled</button><button>Other</button>');
  const snapshot = page.call('SNAPSHOT', { viewport_only: false, max_elements: 1 }).data;
  assert.equal((snapshot.match(/\[\d+\] BUTTON/g) || []).length, 1);
  const id = Number(snapshot.match(/\[(\d+)\] BUTTON/)[1]);
  assert.equal(page.call('CLICK', { id }).success, false);
  page.window.document.body.innerHTML = '';
  assert.equal(page.call('CLICK', { id }).success, false);
});

function background() {
  const tabs = new Map([[1, { id: 1, windowId: 10, url: 'https://first.example', title: 'First' }], [2, { id: 2, windowId: 20, url: 'https://second.example', title: 'Second' }]]);
  const removed: number[] = [];
  const sockets: any[] = [];
  let runtimeListener: any;
  class FakeSocket {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3; static CLOSING = 2;
    readyState = 1; onmessage: any; onopen: any; onclose: any; onerror: any;
    replies: any[] = [];
    constructor(public url: string) { sockets.push(this); }
    send(value: string) { this.replies.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
  }
  const event = () => ({ addListener() {}, removeListener() {} });
  const chrome = {
    storage: { session: { get: async () => ({}), set: async () => {} }, local: { get(_: any, cb: any) { cb({ bridgeToken: 'a'.repeat(64) }); }, set() {} } },
    tabs: { get: async (id: number) => { if (!tabs.has(id)) throw new Error('missing'); return tabs.get(id); }, query: async () => [tabs.get(1)], remove: async (id: number) => { removed.push(id); }, onActivated: event(), onUpdated: event(), onRemoved: event(), sendMessage: async () => ({ success: true }) },
    windows: { onRemoved: event() }, action: { onClicked: event() }, runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener(fn: any) { runtimeListener = fn; } } }
  };
  const context = vm.createContext({ chrome, console, WebSocket: FakeSocket, setInterval() {}, setTimeout, clearTimeout, URL });
  vm.runInContext(readFileSync(new URL('browser-extension/background.js', root), 'utf8'), context);
  async function call(method: string, params: any, session = 'a') {
    const ws = sockets[0];
    ws.onmessage({ data: JSON.stringify({ id: String(ws.replies.length), method, params, session_id: session }) });
    await vm.runInContext('commandQueue', context);
    return ws.replies.at(-1);
  }
  return { context, sockets, tabs, removed, call, ui(msg: any): any { let result; runtimeListener(msg, {}, (res: any) => result = res); return result; } };
}

test('missing explicit and lost bound tabs never fall back to the foreground', async () => {
  const page = background();
  assert.match((await page.call('browser_close_tab', { tab_id: 99 })).error, /不存在/);
  await page.call('browser_bind_tab', { tab_id: 2 });
  page.tabs.delete(2);
  assert.match((await page.call('browser_close_tab', {})).error, /已关闭/);
  assert.deepEqual(page.removed, []);
});

test('sessions retain separate bindings and unbound mutations are refused', async () => {
  const page = background();
  await page.call('browser_bind_tab', { tab_id: 1 }, 'a');
  await page.call('browser_bind_tab', { tab_id: 2 }, 'b');
  assert.equal((await page.call('browser_get_active_tab', {}, 'a')).result.tab_id, 1);
  assert.equal((await page.call('browser_get_active_tab', {}, 'b')).result.tab_id, 2);
  assert.match((await page.call('browser_close_tab', {}, 'new')).error, /指定/);
});

test('changing ports replaces the open connection and invalid configuration is refused', () => {
  const page = background();
  const old = page.sockets[0];
  assert.equal(page.ui({ type: 'SET_PORT', port: 4000, token: 'a'.repeat(64) }).success, true);
  assert.equal(old.readyState, 3);
  assert.equal(page.sockets.at(-1).url, 'ws://127.0.0.1:4000/ws');
  assert.equal(page.ui({ type: 'SET_PORT', port: 70000, token: 'a'.repeat(64) }).success, false);
});

test('a command exception is returned and does not poison subsequent commands', async () => {
  const page = background();
  const failed = await page.call('browser_navigate', { tab_id: 1, url: 123 });
  assert.ok(failed.error);
  assert.equal((await page.call('browser_get_active_tab', { tab_id: 1 })).result.tab_id, 1);
});

test('plaintext default textarea content is omitted from snapshots and body extraction', () => {
  const page = content('<textarea name="password">private-value</textarea><button>Read</button>');
  assert.ok(!page.call('SNAPSHOT').data.includes('private-value'));
  assert.ok(!page.call('GET_TEXT').text.includes('private-value'));
});

test('navigation readiness waits for completion and times out without claiming success', async () => {
 const page = background();
 page.tabs.get(1)!.status = 'complete';
 assert.equal((await vm.runInContext('waitForTabReady(1, 100)', page.context)).id, 1);
 page.tabs.get(1)!.status = 'loading';
 await assert.rejects(vm.runInContext('waitForTabReady(1, 5)', page.context), /加载超时/);
});
