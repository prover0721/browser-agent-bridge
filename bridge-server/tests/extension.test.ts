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
  if (!window.DataTransfer) {
    window.DataTransfer = class DataTransfer {
      files: any[] = [];
      items = {
        add: (file: any) => { this.files.push(file); }
      };
    };
  }
  window.eval(readFileSync(new URL('browser-extension/content.js', root), 'utf8'));
  return {
    window,
    call(action: string, payload = {}): any { let response; listener({ action, payload }, {}, (value: any) => response = value); return response; },
    callAsync(action: string, payload = {}): Promise<any> { return new Promise(resolve => listener({ action, payload }, {}, resolve)); }
  };
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
  const tabs = new Map([[1, { id: 1, windowId: 10, active: true, status: 'complete', url: 'https://first.example', title: 'First' }], [2, { id: 2, windowId: 20, active: true, status: 'complete', url: 'https://second.example', title: 'Second' }]]);
  const removed: number[] = [];
  const windows = new Map([[10, { id: 10 }], [20, { id: 20 }]]);
  const windowCreates: any[] = [], windowUpdates: any[] = [], tabUpdates: any[] = [], domCalls: any[] = [];
  let nextTab = 3, nextWindow = 30, foreground = 10;
  const createTab = (options: any) => {
    const tab = { id: nextTab++, windowId: options.windowId, url: options.url, title: options.url, active: options.active !== false, status: 'complete' };
    tabs.set(tab.id, tab); return tab;
  };
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
    storage: { session: { get: async () => ({}), set: async () => {} }, local: { get(_: any, cb: any) { cb({}); }, set() {} } },
    tabs: {
      get: async (id: number) => { if (!tabs.has(id)) throw new Error('missing'); return tabs.get(id); },
      query: async (query: any) => [...tabs.values()].filter(tab => (!query.windowId || tab.windowId === query.windowId) && (!query.lastFocusedWindow || tab.windowId === foreground) && (!query.active || tab.active)),
      create: async (options: any) => createTab(options),
      update: async (id: number, options: any) => { tabUpdates.push({ id, ...options }); const tab = tabs.get(id); if (!tab) throw new Error('missing'); Object.assign(tab, options); return tab; },
      remove: async (id: number) => { removed.push(id); tabs.delete(id); },
      onActivated: event(), onUpdated: event(), onRemoved: event(),
      sendMessage: async (id: number, message: any) => { domCalls.push({ id, ...message }); return { success: true, message: 'done' }; }
    },
    windows: {
      get: async (id: number) => { const win = windows.get(id); if (!win) throw new Error('missing window'); return { ...win, tabs: [...tabs.values()].filter(tab => tab.windowId === id) }; },
      create: async (options: any) => { windowCreates.push(options); const id = nextWindow++; windows.set(id, { id }); if (options.focused) foreground = id; return { id, tabs: [createTab({ windowId: id, url: options.url })] }; },
      update: async (id: number, options: any) => { windowUpdates.push({ id, ...options }); if (options.focused) foreground = id; return { id }; },
      remove: async (id: number) => { windows.delete(id); for (const tab of tabs.values()) if (tab.windowId === id) tabs.delete(tab.id); },
      onRemoved: event()
    }, action: { onClicked: event() }, runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener(fn: any) { runtimeListener = fn; } } },
    bookmarks: {
      getTree: async () => [
        {
          id: '0',
          title: '',
          children: [
            {
              id: '1',
              title: '收藏夹栏',
              children: [
                { id: '101', title: 'GitHub', url: 'https://github.com', dateAdded: 1000 },
                { id: '102', title: 'Bing Search', url: 'https://www.bing.com', dateAdded: 1001 }
              ]
            },
            {
              id: '2',
              title: '其他收藏夹',
              children: [
                {
                  id: '201',
                  title: '工作项目',
                  children: [
                    { id: '2011', title: '阿里云控制台', url: 'https://aliyun.com', dateAdded: 1002 },
                    { id: '2012', title: 'Antigravity AI', url: 'https://antigravity.google.com', dateAdded: 1003 }
                  ]
                }
              ]
            }
          ]
        }
      ],
      get: async (id: string) => {
        if (id === '101') return [{ id: '101', title: 'GitHub', url: 'https://github.com' }];
        if (id === '2011') return [{ id: '2011', title: '阿里云控制台', url: 'https://aliyun.com' }];
        return [];
      }
    }

  };
  const context = vm.createContext({ chrome, console, WebSocket: FakeSocket, setInterval() {}, setTimeout, clearTimeout, URL });
  vm.runInContext(readFileSync(new URL('browser-extension/background.js', root), 'utf8'), context);
  async function call(method: string, params: any, session = 'a') {
    const ws = sockets[0];
    ws.onmessage({ data: JSON.stringify({ id: String(ws.replies.length), method, params, session_id: session }) });
    await vm.runInContext('commandQueue', context);
    return ws.replies.at(-1);
  }
  return { context, sockets, tabs, removed, call, windowCreates, windowUpdates, tabUpdates, domCalls, closeWindow: (id: number) => { windows.delete(id); for (const tab of tabs.values()) if (tab.windowId === id) tabs.delete(tab.id); }, foreground: () => foreground, setForeground: (id: number) => { foreground = id; }, ui(msg: any): any { let result; runtimeListener(msg, {}, (res: any) => result = res); return result; } };
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
  assert.equal(page.ui({ type: 'SET_PORT', port: 4000 }).success, true);
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

test('extension automatically connects with empty configuration and accepts original 1.4 commands', async () => {
  const page = background();
  assert.equal(page.sockets.length, 1);
  const socket = page.sockets[0];
  assert.equal(socket.url, 'ws://127.0.0.1:3088/ws');
  socket.onmessage({ data: JSON.stringify({ id: 'legacy-1.4', method: 'browser_get_active_tab', params: {} }) });
  await vm.runInContext('commandQueue', page.context);
  assert.equal(socket.replies.at(-1).id, 'legacy-1.4');
  assert.equal(socket.replies.at(-1).result.tab_id, 1);
});


test('background navigation creates its own window and keeps subsequent navigation there', async () => {
 const page = background();
 const original = { ...page.tabs.get(1) };
 const first = await page.call('browser_navigate', { url: 'https://example.com/task' });
 assert.ok(!first.error, first.error);
 const id = first.result.tab_id, windowId = first.result.window_id;
 assert.notEqual(windowId, 10);
 assert.equal(page.windowCreates[0].focused, false);
 assert.equal(page.foreground(), 10);
 assert.deepEqual(page.tabs.get(1), original);
 page.setForeground(20);
 const second = await page.call('browser_navigate', { url: 'https://example.com/next' });
 assert.equal(second.result.tab_id, id);
 assert.equal(second.result.window_id, windowId);
 assert.equal(page.foreground(), 20);
 assert.equal(page.windowCreates.length, 1);
 await page.call('browser_click', { element_id: 1 });
 assert.equal(page.domCalls.at(-1).id, id);
});

test('opening more pages uses the work window; creating the window again reuses its page', async () => {
 const page = background();
 const first = await page.call('browser_create_window', { url: 'https://example.com/first' });
 const reused = await page.call('browser_create_window', {});
 assert.equal(reused.result.tab_id, first.result.tab_id);
 assert.equal(reused.result.url, 'https://example.com/first');
 const extra = await page.call('browser_create_tab', { url: 'https://example.com/second' });
 assert.equal(extra.result.window_id, first.result.window_id);
 assert.notEqual(extra.result.tab_id, first.result.tab_id);
 assert.equal(page.foreground(), 10);
 assert.equal(page.windowCreates.length, 1);
 assert.equal(page.tabs.get(1)!.url, 'https://first.example');
});

test('switching work pages does not steal focus and searches within the work window', async () => {
 const page = background();
 const first = await page.call('browser_create_tab', { url: 'https://example.com/first' });
 await page.call('browser_create_tab', { url: 'https://example.com/second' });
 const changed = await page.call('browser_switch_tab', { title: 'first' });
 assert.equal(changed.result.tab_id, first.result.tab_id);
 assert.equal(changed.result.focused, false);
 assert.equal(page.windowUpdates.length, 0);
 assert.equal(page.foreground(), 10);
 await page.call('browser_switch_tab', { tab_id: first.result.tab_id, focused: true });
 assert.equal(page.foreground(), first.result.window_id);
});

test('a bound user page is preserved when starting autonomous background navigation', async () => {
 const page = background();
 await page.call('browser_bind_tab', { tab_id: 1 });
 const result = await page.call('browser_navigate', { url: 'https://example.com/work' });
 assert.ok(result.result.is_ai_window);
 assert.notEqual(result.result.tab_id, 1);
 assert.equal(page.tabs.get(1)!.url, 'https://first.example');
});

test('closing the work window allows safe recreation and explicit targets still fail closed', async () => {
 const page = background();
 const first = await page.call('browser_navigate', { url: 'https://example.com/first' });
 const firstId = first.result.tab_id;
 page.closeWindow(first.result.window_id);
 const recreated = await page.call('browser_navigate', { url: 'https://example.com/recovered' });
 assert.ok(!recreated.error, recreated.error);
 assert.notEqual(recreated.result.tab_id, firstId);
 assert.notEqual(recreated.result.window_id, first.result.window_id);
 assert.equal(page.tabs.get(1)!.url, 'https://first.example');
 const explicit = await page.call('browser_navigate', { tab_id: firstId, url: 'https://example.com/explicit' });
 assert.match(explicit.error, /不存在/);
});

test('two task sessions use different work windows and preserve the user window', async () => {
 const page = background();
 const a = await page.call('browser_navigate', { url: 'https://example.com/a' }, 'a');
 const b = await page.call('browser_navigate', { url: 'https://example.com/b' }, 'b');
 assert.notEqual(a.result.window_id, b.result.window_id);
 const again = await page.call('browser_navigate', { url: 'https://example.com/a-next' }, 'a');
 assert.equal(again.result.tab_id, a.result.tab_id);
 assert.equal(page.tabs.get(b.result.tab_id)!.url, 'https://example.com/b');
 assert.equal(page.foreground(), 10);
});

test('label wrapping radio button is identified as RADIO and toggles on click', () => {
  const page = content('<label class="el-radio"><input type="radio" name="resume" value="1"><span>朱宝乐_个人简历.pdf</span></label>');
  const snapshot = page.call('SNAPSHOT').data;
  assert.match(snapshot, /RADIO.*朱宝乐_个人简历\.pdf/);
  const id = Number(snapshot.match(/\[(\d+)\] RADIO/)[1]);
  const result = page.call('CLICK', { id });
  assert.equal(result.success, true);
  assert.equal(page.window.document.querySelector('input').checked, true);
});

test('active dialog groups modal elements and isolates background elements', () => {
  const page = content('<div><button>Background Button</button></div><div role="dialog" aria-modal="true"><h3>简历选择</h3><button>Confirm</button></div>');
  const snapshot = page.call('SNAPSHOT').data;
  assert.match(snapshot, /当前活动弹窗: 简历选择/);
  assert.match(snapshot, /Confirm/);
});

test('shadowRoot elements are traversed and exposed in snapshot', () => {
  const page = content('<div id="host"></div>');
  const host = page.window.document.getElementById('host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button id="shadow-btn">Shadow Action</button>';
  const snapshot = page.call('SNAPSHOT').data;
  assert.match(snapshot, /Shadow Action/);
});

test('browser_wait_for resolves immediately when selector already exists', async () => {
  const page = content('<div id="ready">Loaded Content</div>');
  const result = await page.callAsync('WAIT_FOR', { selector: '#ready', timeout_seconds: 1 });
  assert.equal(result.success, true);
  assert.match(result.message, /条件已满足/);
});

test('browser_upload_file injects file into target input and triggers change', () => {
  const page = content('<div class="el-upload"><button id="btn">选择文件</button><input type="file" style="display:none"></div>');
  const snapshot = page.call('SNAPSHOT').data;
  const id = Number(snapshot.match(/\[(\d+)\] BUTTON/)[1]);
  const base64 = Buffer.from('hello pdf content').toString('base64');
  const res = page.call('UPLOAD_FILE', { id, filename: 'my_resume.pdf', mimeType: 'application/pdf', base64 });
  assert.equal(res.success, true);
  assert.match(res.message, /已成功注入文件/);
});

test('browser_list_bookmarks traverses all folders including bookmarks bar and other bookmarks', async () => {
  const page = background();
  const allRes = await page.call('browser_list_bookmarks', {});
  assert.equal(allRes.result.total, 4);
  assert.equal(allRes.result.bookmarks.length, 4);

  // Search by query
  const queryRes = await page.call('browser_list_bookmarks', { query: '阿里云' });
  assert.equal(queryRes.result.total, 1);
  assert.equal(queryRes.result.bookmarks[0].title, '阿里云控制台');
  assert.equal(queryRes.result.bookmarks[0].folder, '其他收藏夹/工作项目');

  // Search by folder
  const folderRes = await page.call('browser_list_bookmarks', { folder: '其他收藏夹' });
  assert.equal(folderRes.result.total, 2);
  const titles = folderRes.result.bookmarks.map((b: any) => b.title);
  assert.ok(titles.includes('阿里云控制台'));
  assert.ok(titles.includes('Antigravity AI'));
});

test('browser_open_bookmark opens matched bookmark in isolated AI window or existing tab', async () => {
  const page = background();
  // Open by query in isolated window
  const openRes = await page.call('browser_open_bookmark', { query: '阿里云' });
  assert.ok(openRes.result);
  assert.equal(openRes.result.opened_bookmark.title, '阿里云控制台');
  assert.ok(openRes.result.tab_id);
  assert.ok(openRes.result.is_ai_window);

  // Open by id in specific tab
  const openByIdRes = await page.call('browser_open_bookmark', { id: '101', tab_id: 1 });
  assert.ok(openByIdRes.result);
  assert.equal(openByIdRes.result.opened_bookmark.title, 'GitHub');
  assert.equal(openByIdRes.result.tab_id, 1);
  assert.equal(page.tabs.get(1)!.url, 'https://github.com');
});
