// background.js - Browser Agent Background Service Worker (Multi-Tab & Dedicated AI Window Isolation)
let socket = null;
let currentPort = 3088;
const sessions = new Map();
let commandQueue = Promise.resolve();
let displayedSessionId = null;
const restoredSessions = chrome.storage.session.get(['sessions']).then(res => {
  for (const [id, state] of Object.entries(res.sessions || {})) sessions.set(id, state);
}).catch(() => {});
let lastSelectedText = '';
let activeControlledTab = null;
let boundTabId = null;   // 锁定的专属后台工作 Tab ID
let aiWindowId = null;   // AI 专属独立工作窗口 ID（与用户主窗口彻底物理隔离）
let domainLock = null;   // 任务安全护栏域名白名单
const attachedDebuggers = new Set();
const cdpDetachTimers = new Map();

// ── CDP Debugger 智能脱钩与物理级真机受信任输入模拟（isTrusted === true） ──
function scheduleCdpDetach(tabId) {
  if (cdpDetachTimers.has(tabId)) {
    clearTimeout(cdpDetachTimers.get(tabId));
  }
  const timer = setTimeout(async () => {
    cdpDetachTimers.delete(tabId);
    if (attachedDebuggers.has(tabId)) {
      try {
        if (chrome.debugger && chrome.debugger.detach) {
          await chrome.debugger.detach({ tabId });
        }
      } catch (_) {}
      attachedDebuggers.delete(tabId);
    }
  }, 600);
  cdpDetachTimers.set(tabId, timer);
}

async function attachCdp(tabId) {
  if (cdpDetachTimers.has(tabId)) {
    clearTimeout(cdpDetachTimers.get(tabId));
    cdpDetachTimers.delete(tabId);
  }
  if (attachedDebuggers.has(tabId)) return;
  if (!chrome.debugger) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedDebuggers.add(tabId);
  } catch (e) {
    if (!e.message?.includes('already attached')) throw e;
    attachedDebuggers.add(tabId);
  }
}

async function cdpDispatchClick(tabId, x, y) {
  if (!chrome.debugger) return;
  await attachCdp(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(x),
    y: Math.round(y)
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    x: Math.round(x),
    y: Math.round(y),
    clickCount: 1
  });
  await new Promise(r => setTimeout(r, 30));
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    x: Math.round(x),
    y: Math.round(y),
    clickCount: 1
  });
  scheduleCdpDetach(tabId);
}

async function cdpDispatchInsertText(tabId, text) {
  if (!chrome.debugger) return;
  await attachCdp(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
  scheduleCdpDetach(tabId);
}

async function cdpDispatchDrag(tabId, startX, startY, endX, endY, steps = 30) {
  if (!chrome.debugger) return;
  await attachCdp(tabId);
  // 1. 移动到起点
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(startX),
    y: Math.round(startY)
  });
  await new Promise(r => setTimeout(r, 40));

  // 2. 按下左键
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    x: Math.round(startX),
    y: Math.round(startY),
    clickCount: 1
  });
  await new Promise(r => setTimeout(r, 30));

  // 3. 拟人化 Ease-Out 三次贝塞尔曲线与高斯手震扰动
  const numSteps = Math.max(10, Math.min(60, steps));
  for (let i = 1; i <= numSteps; i++) {
    const t = i / numSteps;
    const progress = 1 - Math.pow(1 - t, 3);
    const curX = startX + (endX - startX) * progress;
    // Y 轴拟人化随机手震 (-1.5px ~ +1.5px)
    const jitterY = (Math.random() - 0.5) * 3;
    const curY = startY + (endY - startY) * progress + jitterY;

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: Math.round(curX),
      y: Math.round(curY)
    });
    await new Promise(r => setTimeout(r, 8 + Math.floor(Math.random() * 12)));
  }

  // 4. 滑块终点轻微悬停停顿
  await new Promise(r => setTimeout(r, 80 + Math.floor(Math.random() * 40)));

  // 5. 释放左键
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    x: Math.round(endX),
    y: Math.round(endY),
    clickCount: 1
  });

  scheduleCdpDetach(tabId);
}

// 从 storage 加载配置端口
chrome.storage.local.get(['bridgePort'], (res) => {
  if (res.bridgePort) currentPort = res.bridgePort;
  connectBridge();
});

// 5秒定时心跳与自动重连
setInterval(() => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ type: 'PING' }));
    } catch (e) {
      connectBridge();
    }
  } else if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    connectBridge();
  }
}, 3000);

/**
 * 建立与本地 MCP 桥接服务的 WebSocket 连接
 */
function connectBridge(force = false) {
  if (socket) {
    if (!force && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    } catch (e) {}
    socket = null;
  }

  notifySidePanel({ type: 'STATUS_CHANGE', status: 'connecting', port: currentPort });

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${currentPort}/ws`);
    socket = ws;

    ws.onopen = () => {
      console.log(`[BrowserAgent] Connected to Bridge Server on port ${currentPort}`);
      notifySidePanel({ type: 'STATUS_CHANGE', status: 'connected', port: currentPort });
      broadcastActiveTabInfo();
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'PING' || msg.type === 'PONG') return;
      if (msg.type === 'HOT_RELOAD_EXTENSION') {
        console.log('[BrowserAgent] Received hot-reload signal from bridge server, reloading extension...');
        notifySidePanel({ type: 'STATUS_CHANGE', status: 'reloading', port: currentPort });
        if (activeControlledTab && activeControlledTab.id) {
          chrome.tabs.reload(activeControlledTab.id).catch(() => {});
        }
        setTimeout(() => {
          try { chrome.runtime.reload(); } catch {}
        }, 100);
        return;
      }
      if (typeof msg.id !== 'string' || typeof msg.method !== 'string') return;
      // Original 1.4 servers do not send session IDs.
      if (typeof msg.session_id !== 'string') msg.session_id = 'legacy';
      // Serialize commands so another session cannot change global tab context mid-await.
      commandQueue = commandQueue.catch(() => {}).then(async () => {
        await restoredSessions;
        // Requester already gone: skip work and never send to a closed socket.
        if (ws.readyState !== WebSocket.OPEN) return;
        displayedSessionId = msg.session_id;
        const session = sessions.get(msg.session_id) || { boundTabId: null, aiWindowId: null };
        boundTabId = session.boundTabId;
        aiWindowId = session.aiWindowId;
        let response;
        try {
          if (msg.expires_at && Date.now() > msg.expires_at) throw new Error('指令已过期，请检查页面后重新操作');
          // Never log form values, URLs, or credentials.
          notifySidePanel({ type: 'AUDIT_LOG', log: { method: msg.method, params: { tab_id: msg.params?.tab_id } } });
          response = await Promise.race([
            handleBridgeCommand(msg.method, msg.params || {}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('页面响应超时，已跳过该指令')), msg.timeoutMs || 25000)),
          ]);
        } catch (error) { response = { error: error.message }; }
        finally {
          sessions.set(msg.session_id, { boundTabId, aiWindowId });
          // Bound memory; expired sessions fail closed because mutations require a binding.
          if (sessions.size > 256) sessions.delete(sessions.keys().next().value);
          await chrome.storage.session.set({ sessions: Object.fromEntries(sessions) }).catch(() => {});
        }
        await broadcastActiveTabInfo().catch(() => {});
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: msg.id, result: response.result ?? null, error: response.error ?? null }));
      });
    };

    ws.onclose = () => {
      console.log('[BrowserAgent] Disconnected from Bridge.');
      if (socket === ws) socket = null;
      notifySidePanel({ type: 'STATUS_CHANGE', status: 'disconnected', port: currentPort });
    };

    ws.onerror = (err) => {
      console.warn('[BrowserAgent] WebSocket error:', err);
      try { ws.close(); } catch (e) {}
      if (socket === ws) socket = null;
      notifySidePanel({ type: 'STATUS_CHANGE', status: 'disconnected', port: currentPort });
    };
  } catch (err) {
    socket = null;
    notifySidePanel({ type: 'STATUS_CHANGE', status: 'disconnected', port: currentPort });
  }
}

/**
 * 确保或创建 AI 专属独立工作窗口（绝对不往用户主窗口中塞入标签页）
 */
async function waitForTabReady(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = async (error, tab) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) {
        reject(error);
        return;
      }
      // SPA 标题与水合就绪探针：等待 SPA 路由解析与真实标题挂载（最多等待 600ms）
      try {
        let currentTab = tab || (await chrome.tabs.get(tabId).catch(() => null));
        if (currentTab && (!currentTab.title || /^(未命名|about:blank|untitled)$/i.test(currentTab.title.trim()))) {
          const start = Date.now();
          while (Date.now() - start < 600) {
            await new Promise(r => setTimeout(r, 100));
            currentTab = await chrome.tabs.get(tabId).catch(() => null);
            if (currentTab && currentTab.title && !/^(未命名|about:blank|untitled)$/i.test(currentTab.title.trim())) {
              break;
            }
          }
        }
        resolve(currentTab || tab);
      } catch {
        resolve(tab);
      }
    };
    const onUpdated = (id, change, tab) => { if (id === tabId && change.status === 'complete') finish(null, tab); };
    const onRemoved = id => { if (id === tabId) finish(new Error('等待期间标签页已关闭')); };
    const timer = setTimeout(() => finish(new Error('页面加载超时，请检查页面后重试')), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then(tab => { if (tab && tab.status === 'complete') finish(null, tab); }, error => finish(error));
  });
}

async function ensureAiWindow(url, makeActive = false, reuseTab = false) {
  let win = null;
  if (aiWindowId) {
    try { win = await chrome.windows.get(aiWindowId, { populate: true }); }
    catch { aiWindowId = null; }
  }
  if (win) {
    let tab;
    if (reuseTab) {
      tab = win.tabs?.find(tab => tab.id === boundTabId) || win.tabs?.find(tab => tab.active) || win.tabs?.[0];
    }
    if (tab) {
      if (url) tab = await chrome.tabs.update(tab.id, { url });
    } else {
      tab = await chrome.tabs.create({ windowId: win.id, url: url || 'https://www.bing.com', active: makeActive });
    }
    if (makeActive) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(win.id, { focused: true });
    }
    try { if (tab?.id) await chrome.tabs.update(tab.id, { muted: true }); } catch {}
    return { tab, isNewWindow: false, windowId: win.id };
  }
  // 规范 AI 独立工作窗口为标准桌面尺寸 1440x900，杜绝移动端折叠或抽屉遮罩
  const created = await chrome.windows.create({
    url: url || 'https://www.bing.com',
    focused: false,
    state: 'normal',
    width: 1440,
    height: 900
  });
  aiWindowId = created.id;
  const tab = created.tabs?.[0] || (await chrome.tabs.query({ windowId: created.id }))[0];
  try { if (tab?.id) await chrome.tabs.update(tab.id, { muted: true }); } catch {}
  return { tab, isNewWindow: true, windowId: created.id };
}

/**
 * 获取当前目标受控标签页（优先使用显式指定的 tab_id，其次使用锁定的 boundTabId，最后 fallback 到当前前台活动 Tab）
 */
async function resolveTargetTab(requestedTabId) {
  // 1. 如果指令中直接指定了 tab_id
  if (requestedTabId) {
    try {
      const tab = await chrome.tabs.get(requestedTabId);
      if (tab) return tab;
    } catch (e) {}
    throw new Error(`目标标签页不存在: ${requestedTabId}`);
  }

  // 2. 如果当前有锁定的后台 Tab
  if (boundTabId) {
    try {
      const tab = await chrome.tabs.get(boundTabId);
      if (tab) return tab;
    } catch (e) {
      // Keep the lost binding: mutations must fail until explicitly rebound.
      throw new Error(`绑定标签页已关闭: ${boundTabId}，请重新绑定`);
    }
  }

  // 3. Fallback: 获取当前前台活动的 Tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('edge://')) {
      activeControlledTab = tab;
      return tab;
    }
  } catch (e) {}

  return null;
}

/**
 * 确保标签页已注入 content.js
 */
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'PING' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * 递归扁平化书签树，提取所有有效书签及其完整目录路径
 */
function flattenBookmarkTree(nodes, currentPath = '', results = []) {
  if (!Array.isArray(nodes)) return results;
  for (const node of nodes) {
    const nodeTitle = node.title || (node.id === '0' ? '' : '未命名');
    const folderPath = currentPath ? (nodeTitle ? `${currentPath}/${nodeTitle}` : currentPath) : nodeTitle;
    if (node.url) {
      results.push({
        id: String(node.id),
        title: node.title || '无标题',
        url: node.url,
        folder: currentPath || '根目录',
        path: folderPath,
        dateAdded: node.dateAdded
      });
    } else if (node.children && node.children.length > 0) {
      flattenBookmarkTree(node.children, folderPath, results);
    }
  }
  return results;
}

/**
 * 检索书签列表
 */
async function searchBookmarksList({ query, folder, limit = 50 } = {}) {
  if (!chrome.bookmarks || typeof chrome.bookmarks.getTree !== 'function') {
    throw new Error('当前浏览器未提供 bookmarks API 权限，请在扩展管理页重新加载扩展以获取权限');
  }
  const tree = await chrome.bookmarks.getTree();
  const allBookmarks = flattenBookmarkTree(tree);

  let filtered = allBookmarks;

  if (folder && typeof folder === 'string' && folder.trim()) {
    const fKw = folder.trim().toLowerCase();
    filtered = filtered.filter(b =>
      b.folder.toLowerCase().includes(fKw) || b.path.toLowerCase().includes(fKw)
    );
  }

  if (query && typeof query === 'string' && query.trim()) {
    const qKw = query.trim().toLowerCase();
    filtered = filtered.filter(b =>
      b.title.toLowerCase().includes(qKw) ||
      b.url.toLowerCase().includes(qKw) ||
      b.folder.toLowerCase().includes(qKw)
    );
  }

  const max = Number.isInteger(limit) && limit > 0 ? limit : 50;
  return {
    total: filtered.length,
    count: Math.min(filtered.length, max),
    bookmarks: filtered.slice(0, max)
  };
}

/**
 * 处理来自 Bridge Server 的指令
 */
async function handleBridgeCommand(method, params) {
  if (['browser_navigate', 'browser_create_tab', 'browser_create_window'].includes(method) && params.url !== undefined && (typeof params.url !== 'string' || !params.url.trim())) {
    return { error: 'url 必须是非空网址字符串' };
  }
  // ── 1. 窗口与多标签页管理类命令 ──
  if (method === 'browser_create_window') {
    let url = params.url;
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    const makeActive = params.focused === true;
    const { tab, windowId } = await ensureAiWindow(url, makeActive, true);
    
    boundTabId = tab.id;
    notifySidePanel({ type: 'TAB_LOCK_CHANGED', boundTabId: tab.id });
    await waitForTabReady(tab.id);

    return {
      result: {
        window_id: windowId,
        tab_id: tab.id,
        url: (await chrome.tabs.get(tab.id)).url,
        message: `已创建/获取 AI 专属独立工作窗口 (Window ID: ${windowId}, Tab ID: ${tab.id})，已使用独立工作窗口。`
      }
    };
  }

  if (method === 'browser_close_window') {
    if (aiWindowId) {
      const winId = aiWindowId;
      try {
        await chrome.windows.remove(winId);
      } catch (e) { return { error: `关闭工作窗口失败: ${e.message}` }; }
      aiWindowId = null;
      boundTabId = null;
      notifySidePanel({ type: 'TAB_LOCK_CHANGED', boundTabId: null });
      broadcastActiveTabInfo();
      return { result: { message: `已成功关闭 AI 专属工作窗口 (Window ID: ${winId})，清理完毕！` } };
    }
    return { result: { message: '当前没有活动的 AI 专属工作窗口。' } };
  }

  if (method === 'browser_list_tabs') {
    const tabs = await chrome.tabs.query({});
    const safeTabs = tabs
      .filter((t) => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://'))
      .map((t) => ({
        tab_id: t.id,
        window_id: t.windowId,
        is_ai_window: t.windowId === aiWindowId,
        title: t.title,
        url: t.url,
        active: t.active,
        is_bound: t.id === boundTabId,
        favIconUrl: t.favIconUrl
      }));
    return { result: safeTabs };
  }

  if (method === 'browser_create_tab') {
    if (!params.url) return { error: '未提供 url 参数' };
    let url = params.url;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    const makeActive = params.active === true;
    const isolateWindow = params.isolate_window !== false; // 默认隔离到 AI 专属独立窗口

    let newTab = null;
    let targetWinId = null;

    if (isolateWindow) {
      // 核心隔离逻辑：使用独立专属窗口，不污染用户主窗口
      const res = await ensureAiWindow(url, makeActive);
      newTab = res.tab;
      targetWinId = res.windowId;
    } else {
      // 允许在当前窗口打开
      newTab = await chrome.tabs.create({ url, active: makeActive });
      targetWinId = newTab.windowId;
    }

    if (params.auto_bind !== false && newTab) {
      boundTabId = newTab.id;
      notifySidePanel({ type: 'TAB_LOCK_CHANGED', boundTabId: newTab.id });
    }

    newTab = await waitForTabReady(newTab.id);

    return {
      result: {
        tab_id: newTab.id,
        window_id: targetWinId,
        is_ai_window: targetWinId === aiWindowId,
        url: newTab.url || url,
        title: newTab.title,
        is_bound: boundTabId === newTab.id,
        message: isolateWindow
          ? `已在【AI 专属独立窗口】中静默打开页面 (Tab: ${newTab.id}, Win: ${targetWinId})，用户主窗口未受任何影响。`
          : `已成功创建新标签页 (ID: ${newTab.id})`
      }
    };
  }

  if (method === 'browser_bind_tab') {
    if (!params.tab_id) return { error: '未提供要锁定的 tab_id' };
    try {
      const tab = await chrome.tabs.get(params.tab_id);
      boundTabId = tab.id;
      notifySidePanel({ type: 'TAB_LOCK_CHANGED', boundTabId: tab.id });
      broadcastActiveTabInfo();
      return {
        result: {
          bound_tab_id: tab.id,
          title: tab.title,
          url: tab.url,
          message: `已成功锁定标签页 [ID: ${tab.id}] "${tab.title}"。后续操作将在该后台页面持续执行。`
        }
      };
    } catch (e) {
      return { error: `无法找到标签页 ID: ${params.tab_id}` };
    }
  }

  if (method === 'browser_unbind_tab') {
    const oldId = boundTabId;
    boundTabId = null;
    notifySidePanel({ type: 'TAB_LOCK_CHANGED', boundTabId: null });
    broadcastActiveTabInfo();
    return {
      result: {
        message: `已解除标签页锁定 (原 ID: ${oldId})。现在已恢复自动跟随模式。`
      }
    };
  }

  if (method === 'browser_switch_tab') {
    let targetTab = null;
    const allTabs = await chrome.tabs.query({});
    const tabs = !params.tab_id && params.focused !== true && aiWindowId
      ? allTabs.filter(tab => tab.windowId === aiWindowId) : allTabs;

    // 1. 按 tab_id 精确查找
    if (params.tab_id) {
      targetTab = tabs.find((t) => t.id === params.tab_id);
    }
    // 2. 按 title / keyword 模糊查找
    else if (params.title || params.keyword) {
      const kw = (params.title || params.keyword).toLowerCase().trim();
      targetTab = tabs.find((t) => t.title && t.title.toLowerCase().includes(kw));
      if (!targetTab) {
        targetTab = tabs.find((t) => t.url && t.url.toLowerCase().includes(kw));
      }
    }

    if (!targetTab) {
      return { error: `未找到匹配的标签页（查询条件: ${JSON.stringify(params)}）` };
    }

    // 物理切换浏览器前台显示
    try {
      if (params.focused === true) {
        await chrome.windows.update(targetTab.windowId, { focused: true });
        await chrome.tabs.update(targetTab.id, { active: true });
      }
    } catch (e) {
      return { error: `切换标签页失败: ${e.message}` };
    }

    // 同步更新受控状态与侧边栏
    activeControlledTab = targetTab;
    boundTabId = targetTab.id;
    broadcastActiveTabInfo();

    return {
      result: {
        tab_id: targetTab.id,
        window_id: targetTab.windowId,
        title: targetTab.title,
        url: targetTab.url,
        focused: params.focused === true,
        message: `已切换受控页面到【${targetTab.title}】，${params.focused === true ? "已显示窗口" : "保持前台窗口不变"}`
      }
    };
  }

  if (method === 'browser_close_tab') {
    if (!params.tab_id && !boundTabId) return { error: '关闭前请指定 tab_id 或绑定标签页' };
    const targetTab = await resolveTargetTab(params.tab_id);
    if (!targetTab || !targetTab.id) return { error: '未找到要关闭的标签页' };
    const closedId = targetTab.id;
    if (boundTabId === closedId) {
      boundTabId = null;
      notifySidePanel({ type: 'TAB_LOCK_CHANGED', boundTabId: null });
    }
    await chrome.tabs.remove(closedId);
    return { result: { message: `已关闭标签页 [ID: ${closedId}] "${targetTab.title}"` } };
  }

  // ── 1.5 书签与收藏夹检索管理 ──
  if (method === 'browser_list_bookmarks') {
    try {
      const res = await searchBookmarksList({
        query: params.query,
        folder: params.folder,
        limit: params.limit
      });
      return { result: res };
    } catch (e) {
      return { error: `获取书签失败: ${e.message}` };
    }
  }

  if (method === 'browser_open_bookmark') {
    try {
      let targetBookmark = null;
      if (params.id) {
        if (!chrome.bookmarks || typeof chrome.bookmarks.get !== 'function') {
          throw new Error('当前浏览器未提供 bookmarks API 权限，请在扩展管理页重新加载扩展以获取权限');
        }
        const nodes = await chrome.bookmarks.get(String(params.id));
        if (nodes && nodes[0] && nodes[0].url) {
          targetBookmark = {
            id: String(nodes[0].id),
            title: nodes[0].title || '无标题',
            url: nodes[0].url,
            folder: '',
            path: nodes[0].title || ''
          };
        } else {
          return { error: `未找到 ID 为 "${params.id}" 的有效书签，或该节点为文件夹` };
        }
      } else {
        if (!params.query && !params.folder) {
          return { error: '请提供书签搜索关键字 (query) 或收藏夹名称 (folder)，或者直接传入书签 id' };
        }
        const searchRes = await searchBookmarksList({
          query: params.query,
          folder: params.folder,
          limit: 100
        });
        if (searchRes.total === 0) {
          return { error: `未找到匹配 "${params.query || params.folder}" 的书签。可使用 browser_list_bookmarks 查询现有书签。` };
        }
        // 匹配打分排序：精确匹配 > 开头匹配 > 包含
        const qLower = (params.query || '').trim().toLowerCase();
        const sorted = [...searchRes.bookmarks].sort((a, b) => {
          if (!qLower) return 0;
          const aTitle = a.title.toLowerCase();
          const bTitle = b.title.toLowerCase();
          if (aTitle === qLower && bTitle !== qLower) return -1;
          if (bTitle === qLower && aTitle !== qLower) return 1;
          if (aTitle.startsWith(qLower) && !bTitle.startsWith(qLower)) return -1;
          if (bTitle.startsWith(qLower) && !aTitle.startsWith(qLower)) return 1;
          return 0;
        });
        targetBookmark = sorted[0];
      }

      if (!targetBookmark || !targetBookmark.url) {
        return { error: '未获取到目标书签的有效网址' };
      }

      // 如果指定了 tab_id，则在指定的标签页中跳转
      if (params.tab_id) {
        const updatedTab = await chrome.tabs.update(params.tab_id, { url: targetBookmark.url });
        await waitForTabReady(params.tab_id);
        return {
          result: {
            opened_bookmark: targetBookmark,
            tab_id: updatedTab.id,
            window_id: updatedTab.windowId,
            message: `已在标签页 [ID: ${updatedTab.id}] 中成功打开书签【${targetBookmark.title}】(${targetBookmark.url})`
          }
        };
      }

      // 默认在 AI 专属隔离窗口中新建或复用标签页
      const createRes = await handleBridgeCommand('browser_create_tab', {
        url: targetBookmark.url,
        active: params.active === true,
        isolate_window: params.isolate_window !== false,
        auto_bind: params.auto_bind !== false
      });
      if (createRes.error) return createRes;

      return {
        result: {
          opened_bookmark: targetBookmark,
          tab_id: createRes.result.tab_id,
          window_id: createRes.result.window_id,
          is_ai_window: createRes.result.is_ai_window,
          message: `已成功在${createRes.result.is_ai_window ? ' AI 专属独立窗口' : '当前窗口'}打开书签【${targetBookmark.title}】(${targetBookmark.url})`
        }
      };
    } catch (e) {
      return { error: `打开书签失败: ${e.message}` };
    }
  }

  // ── 1.6 开发者信息免 F12 获取 (Cookies) ──
  if (method === 'browser_get_cookies') {
    try {
      if (!chrome.cookies || typeof chrome.cookies.getAll !== 'function') {
        return { error: '当前浏览器未提供 cookies API 权限，请在扩展管理页重新加载扩展以获取权限' };
      }
      let targetUrl = params.url;
      let targetDomain = params.domain;

      if (!targetUrl && !targetDomain) {
        const targetTab = await resolveTargetTab(params.tab_id);
        if (targetTab && targetTab.url) {
          targetUrl = targetTab.url;
        }
      }

      if (!targetUrl && !targetDomain) {
        return { error: '请提供目标网址 (url) 或域名 (domain)，或确保浏览器有打开的受控标签页' };
      }

      const queryDetails = {};
      if (targetUrl) {
        if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
        queryDetails.url = targetUrl;
      }
      if (targetDomain) {
        queryDetails.domain = targetDomain.replace(/^[.]+/, '');
      }

      const cookies = await chrome.cookies.getAll(queryDetails);
      let filtered = cookies;

      const filterNames = Array.isArray(params.names) ? params.names : (params.name ? [params.name] : null);
      if (filterNames && filterNames.length > 0) {
        filtered = filtered.filter(c => filterNames.includes(c.name));
      }

      const map = {};
      for (const c of filtered) {
        map[c.name] = c.value;
      }

      const cookieHeader = filtered.map(c => `${c.name}=${c.value}`).join('; ');

      return {
        result: {
          url: targetUrl || null,
          domain: targetDomain || null,
          total: filtered.length,
          cookie_header: cookieHeader,
          cookies_map: map,
          cookies: filtered.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate
          }))
        }
      };
    } catch (e) {
      return { error: `获取 Cookies 失败: ${e.message}` };
    }
  }

  // ── 1.7 闭环文件流：下载监听与追踪 ──
  if (method === 'browser_wait_for_download') {
    if (!chrome.downloads) {
      return { error: '当前浏览器未提供 downloads API 权限，请在扩展管理页重新加载扩展' };
    }
    const timeoutMs = Math.max(1000, Math.min(120000, (Number(params.timeout_seconds) || 30) * 1000));
    const startTimestamp = Date.now() - 3000;

    return new Promise((resolve) => {
      let resolved = false;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        chrome.downloads.onCreated.removeListener(onCreated);
        chrome.downloads.onChanged.removeListener(onChanged);
      };

      const finish = (result, error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        if (error) resolve({ error });
        else resolve({ result });
      };

      timer = setTimeout(() => {
        chrome.downloads.search({ startedAfter: new Date(startTimestamp).toISOString(), limit: 1 }).then((items) => {
          if (items && items.length > 0) {
            const item = items[0];
            finish({
              id: item.id,
              filename: item.filename,
              state: item.state,
              total_bytes: item.totalBytes,
              mime: item.mime,
              url: item.url,
              message: item.state === 'complete' ? `文件下载已完成: ${item.filename}` : `下载正在进行中 (${item.bytesReceived}/${item.totalBytes})`
            });
          } else {
            finish(null, `等待文件下载超时 (${timeoutMs / 1000}秒)，未检测到新下载任务`);
          }
        }).catch(() => {
          finish(null, `等待文件下载超时 (${timeoutMs / 1000}秒)`);
        });
      }, timeoutMs);

      let trackedDownloadId = null;

      const onCreated = (item) => {
        trackedDownloadId = item.id;
      };

      const onChanged = (delta) => {
        if (trackedDownloadId && delta.id !== trackedDownloadId) return;
        if (delta.state) {
          if (delta.state.current === 'complete') {
            chrome.downloads.search({ id: delta.id }).then((items) => {
              const item = items[0] || {};
              finish({
                id: delta.id,
                filename: item.filename || delta.filename?.current || '未知路径',
                state: 'complete',
                total_bytes: item.totalBytes || 0,
                mime: item.mime || '',
                url: item.url || '',
                message: `文件下载已成功完成！本地路径: ${item.filename || delta.filename?.current}`
              });
            }).catch(() => {
              finish({
                id: delta.id,
                filename: delta.filename?.current || '未知路径',
                state: 'complete',
                message: '文件下载已完成'
              });
            });
          } else if (delta.state.current === 'interrupted') {
            finish(null, `下载异常中断: ${delta.error?.current || '未知网络错误'}`);
          }
        }
      };

      chrome.downloads.onCreated.addListener(onCreated);
      chrome.downloads.onChanged.addListener(onChanged);

      // 立即检查一次是否刚刚已完成
      chrome.downloads.search({ startedAfter: new Date(startTimestamp).toISOString(), limit: 1 }).then((items) => {
        if (items && items.length > 0 && items[0].state === 'complete') {
          const item = items[0];
          finish({
            id: item.id,
            filename: item.filename,
            state: item.state,
            total_bytes: item.totalBytes,
            mime: item.mime,
            url: item.url,
            message: `文件下载已完成！本地路径: ${item.filename}`
          });
        }
      }).catch(() => {});
    });
  }

  if (method === 'browser_get_downloads') {
    if (!chrome.downloads) {
      return { error: '当前浏览器未提供 downloads API 权限，请在扩展管理页重新加载扩展' };
    }
    try {
      const limit = Math.min(50, Math.max(1, Number(params.limit) || 10));
      const queryDetails = { limit };
      if (params.query) queryDetails.query = [params.query];
      if (params.state) queryDetails.state = params.state;
      const items = await chrome.downloads.search(queryDetails);
      return {
        result: {
          total: items.length,
          downloads: items.map(item => ({
            id: item.id,
            filename: item.filename,
            state: item.state,
            total_bytes: item.totalBytes,
            bytes_received: item.bytesReceived,
            mime: item.mime,
            url: item.url,
            start_time: item.startTime,
            end_time: item.endTime
          }))
        }
      };
    } catch (e) {
      return { error: `获取下载记录失败: ${e.message}` };
    }
  }

  // ── 1.8 基础历史导航控制 ──
  if (method === 'browser_go_back') {
    const targetTab = await resolveTargetTab(params.tab_id);
    if (!targetTab || !targetTab.id) return { error: '未找到受控标签页' };
    try {
      await chrome.tabs.goBack(targetTab.id);
      return { result: { tab_id: targetTab.id, message: `标签页 [ID: ${targetTab.id}] 已执行后退` } };
    } catch (e) {
      return { error: `后退失败: ${e.message}` };
    }
  }

  if (method === 'browser_go_forward') {
    const targetTab = await resolveTargetTab(params.tab_id);
    if (!targetTab || !targetTab.id) return { error: '未找到受控标签页' };
    try {
      await chrome.tabs.goForward(targetTab.id);
      return { result: { tab_id: targetTab.id, message: `标签页 [ID: ${targetTab.id}] 已执行前进` } };
    } catch (e) {
      return { error: `前进失败: ${e.message}` };
    }
  }

  if (method === 'browser_reload') {
    const targetTab = await resolveTargetTab(params.tab_id);
    if (!targetTab || !targetTab.id) return { error: '未找到受控标签页' };
    try {
      await chrome.tabs.reload(targetTab.id, { bypassCache: params.bypass_cache === true });
      return { result: { tab_id: targetTab.id, message: `标签页 [ID: ${targetTab.id}] 已刷新${params.bypass_cache === true ? ' (强制忽略缓存)' : ''}` } };
    } catch (e) {
      return { error: `刷新失败: ${e.message}` };
    }
  }

  // ── 1.9 扩展自愈与热重载控制 ──
  if (method === 'browser_reload_extension') {
    try {
      const reloadTabs = params.reload_tabs !== false;
      let reloadedTabId = null;
      if (reloadTabs) {
        const targetTab = await resolveTargetTab(params.tab_id).catch(() => null);
        if (targetTab && targetTab.id) {
          reloadedTabId = targetTab.id;
          await chrome.tabs.reload(reloadedTabId).catch(() => {});
        }
      }
      setTimeout(() => {
        try { chrome.runtime.reload(); } catch {}
      }, 100);
      return {
        result: {
          success: true,
          reloaded_tab_id: reloadedTabId,
          message: '浏览器扩展已执行重载 (chrome.runtime.reload())' + (reloadedTabId ? `，并已同步刷新标签页 [ID: ${reloadedTabId}]` : '')
        }
      };
    } catch (e) {
      return { error: `扩展重载失败: ${e.message}` };
    }
  }

  // ── 2.0 任务安全护栏与域名白名单 ──
  if (method === 'browser_set_guard') {
    if (params.domain_lock) {
      domainLock = Array.isArray(params.domain_lock) ? params.domain_lock : [params.domain_lock];
    } else {
      domainLock = null;
    }
    return {
      result: {
        domain_lock: domainLock,
        message: `安全护栏已生效，受控域名白名单: ${domainLock ? domainLock.join(', ') : '无限制'}`
      }
    };
  }

  // ── 2.0 靶向屏幕与局部元素截图 ──
  if (method === 'browser_screenshot') {
    const targetTab = await resolveTargetTab(params.tab_id);
    if (!targetTab || !targetTab.id) return { error: '未找到目标标签页' };

    const format = params.format === 'png' ? 'png' : 'jpeg';
    const quality = Math.min(100, Math.max(1, Number(params.quality) || 80));

    let dataUrl = '';
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, {
        format,
        quality: format === 'png' ? undefined : quality
      });
    } catch (err) {
      return { error: `截图失败: ${err.message}` };
    }

    if (params.element_id !== undefined || params.selector) {
      await ensureContentScriptInjected(targetTab.id);
      try {
        const bounds = await chrome.tabs.sendMessage(targetTab.id, {
          action: 'GET_ELEMENT_BOUNDS',
          payload: { element_id: params.element_id, selector: params.selector }
        });
        if (bounds?.success && bounds.rect) {
          return {
            result: {
              data_url: dataUrl,
              rect: bounds.rect,
              element_id: params.element_id,
              selector: params.selector,
              format,
              message: `已成功获取目标元素视口截图坐标 (x: ${bounds.rect.left}, y: ${bounds.rect.top}, w: ${bounds.rect.width}, h: ${bounds.rect.height})`
            }
          };
        }
      } catch {}
    }

    return {
      result: {
        data_url: dataUrl,
        format,
        message: '已成功捕获当前视口屏幕截图'
      }
    };
  }

  // Navigation without an explicit target starts independent work automatically.
  if (method === 'browser_navigate' && !params.tab_id) {
    if (!params.url) return { error: '未提供导航目标 URL' };
    const bound = boundTabId ? await chrome.tabs.get(boundTabId).catch(() => null) : null;
    if (!bound || bound.windowId !== aiWindowId) {
      return handleBridgeCommand('browser_create_tab', { url: params.url });
    }
  }

  // ── 2. 页面级信息与跳转命令 ──
  const mutations = ['browser_navigate', 'browser_click', 'browser_type', 'browser_hover', 'browser_press', 'browser_scroll', 'browser_upload_file', 'browser_fill_form', 'browser_insert_text', 'browser_drag'];
  if (mutations.includes(method) && !params.tab_id && !boundTabId) return { error: '修改页面前请指定 tab_id 或绑定标签页' };
  const targetTab = await resolveTargetTab(params.tab_id);
  if (!targetTab || !targetTab.id) {
    return { error: '当前没有可用的浏览器标签页，请先打开一个网页。' };
  }

  if (method === 'browser_get_active_tab') {
    return {
      result: {
        tab_id: targetTab.id,
        window_id: targetTab.windowId,
        is_ai_window: targetTab.windowId === aiWindowId,
        title: targetTab.title,
        url: targetTab.url,
        is_bound: targetTab.id === boundTabId,
        mode: boundTabId ? 'pinned_background' : 'auto_follow_active'
      }
    };
  }

  if (method === 'browser_navigate') {
    if (!params.url) return { error: '未提供导航目标 URL' };
    let url = params.url;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (domainLock && domainLock.length > 0) {
      try {
        const parsed = new URL(url);
        const isAllowed = domainLock.some(d => parsed.hostname.endsWith(d));
        if (!isAllowed) {
          return { error: `[安全护栏拦截]: 目标网址 ${url} 不在当前任务白名单 (${domainLock.join(', ')}) 中，已阻止跳出！` };
        }
      } catch {}
    }
    await chrome.tabs.update(targetTab.id, { url });
    await waitForTabReady(targetTab.id);
    const loaded = await chrome.tabs.get(targetTab.id);
    return { result: { tab_id: loaded.id, window_id: loaded.windowId, url: loaded.url, title: loaded.title, is_ai_window: loaded.windowId === aiWindowId, message: `标签页 [${targetTab.id}] 已跳转至: ${url}` } };
  }

  // ── 3. 派发给 Content Script 的 DOM 操作 ──
  try {
    await ensureContentScriptInjected(targetTab.id);

    let action = '';
    let payload = {};

    switch (method) {
      case 'browser_snapshot':
        action = 'SNAPSHOT';
        payload = {
          viewport_only: params.viewport_only !== false,
          max_elements: params.max_elements || 50,
          reveal_hover: params.reveal_hover !== false,
          ignore_dialog: params.ignore_dialog === true,
          diff_only: params.diff_only === true
        };
        break;
      case 'browser_click':
        if (params.trusted === true) {
          await ensureContentScriptInjected(targetTab.id);
          const bounds = await chrome.tabs.sendMessage(targetTab.id, {
            action: 'GET_ELEMENT_BOUNDS',
            payload: { element_id: params.element_id, selector: params.selector, text: params.text }
          });
          if (bounds?.success && bounds.rect) {
            const x = bounds.rect.left + bounds.rect.width / 2;
            const y = bounds.rect.top + bounds.rect.height / 2;
            await cdpDispatchClick(targetTab.id, x, y);
            const fbRes = await chrome.tabs.sendMessage(targetTab.id, { action: 'GET_FEEDBACK' }).catch(() => null);
            return {
              result: {
                success: true,
                trusted: true,
                message: `已通过 CDP 物理级真机模拟点击元素 (x: ${Math.round(x)}, y: ${Math.round(y)}, isTrusted: true)`,
                feedback: fbRes?.feedback
              }
            };
          }
        }
        action = 'CLICK';
        payload = {
          id: params.element_id,
          element_id: params.element_id,
          text: params.text,
          selector: params.selector,
          snapshot_id: params.snapshot_id,
          humanlike: params.humanlike !== false
        };
        break;
      case 'browser_drag':
        if (params.trusted !== false) {
          await ensureContentScriptInjected(targetTab.id);
          const bounds = await chrome.tabs.sendMessage(targetTab.id, {
            action: 'GET_ELEMENT_BOUNDS',
            payload: { element_id: params.element_id, selector: params.selector, text: params.text, is_slider: true }
          });
          if (bounds?.success && bounds.rect) {
            const startX = bounds.rect.left + bounds.rect.width / 2;
            const startY = bounds.rect.top + bounds.rect.height / 2;
            const distanceX = Number(params.distance_x) || (bounds.track_width ? Math.max(200, bounds.track_width - bounds.rect.width) : 300);
            const distanceY = Number(params.distance_y) || 0;
            const endX = startX + distanceX;
            const endY = startY + distanceY;
            const steps = Number(params.steps) || 30;

            await cdpDispatchDrag(targetTab.id, startX, startY, endX, endY, steps);
            await new Promise(r => setTimeout(r, 600));
            const fbRes = await chrome.tabs.sendMessage(targetTab.id, { action: 'GET_FEEDBACK' }).catch(() => null);

            return {
              result: {
                success: true,
                trusted: true,
                start: { x: Math.round(startX), y: Math.round(startY) },
                end: { x: Math.round(endX), y: Math.round(endY) },
                distance_x: distanceX,
                distance_y: distanceY,
                message: `已通过 CDP 物理级真机模拟完成平滑拖拽/滑块验证 (从 x:${Math.round(startX)} 拖动至 x:${Math.round(endX)})`,
                feedback: fbRes?.feedback
              }
            };
          }
        }
        action = 'DRAG';
        payload = {
          element_id: params.element_id,
          selector: params.selector,
          distance_x: params.distance_x || 300,
          distance_y: params.distance_y || 0,
          steps: params.steps || 25
        };
        break;
      case 'browser_hover':
        action = 'HOVER';
        payload = {
          id: params.element_id,
          element_id: params.element_id,
          selector: params.selector,
          text: params.text,
          snapshot_id: params.snapshot_id
        };
        break;
      case 'browser_type':
        if (params.trusted === true) {
          await ensureContentScriptInjected(targetTab.id);
          const bounds = await chrome.tabs.sendMessage(targetTab.id, {
            action: 'GET_ELEMENT_BOUNDS',
            payload: { element_id: params.element_id, selector: params.selector }
          });
          if (bounds?.success && bounds.rect) {
            const x = bounds.rect.left + bounds.rect.width / 2;
            const y = bounds.rect.top + bounds.rect.height / 2;
            await cdpDispatchClick(targetTab.id, x, y);
            await new Promise(r => setTimeout(r, 40));
            await cdpDispatchInsertText(targetTab.id, params.text);
            const fbRes = await chrome.tabs.sendMessage(targetTab.id, { action: 'GET_FEEDBACK' }).catch(() => null);
            return {
              result: {
                success: true,
                trusted: true,
                message: `已通过 CDP 物理级真机模拟向元素输入 "${params.text}" (isTrusted: true)`,
                feedback: fbRes?.feedback
              }
            };
          }
        }
        action = 'TYPE';
        payload = {
          id: params.element_id,
          snapshot_id: params.snapshot_id,
          text: params.text,
          clearFirst: params.clear_first !== false
        };
        break;
      case 'browser_press':
        action = 'PRESS';
        payload = { key: params.key };
        break;
      case 'browser_insert_text':
        action = 'INSERT_TEXT';
        payload = {
          id: params.element_id,
          snapshot_id: params.snapshot_id,
          text: params.text
        };
        break;
      case 'browser_scroll':
        action = 'SCROLL';
        payload = { direction: params.direction || 'down', amount: params.amount || 500 };
        break;
      case 'browser_get_text':
        action = 'GET_TEXT';
        payload = { id: params.element_id, snapshot_id: params.snapshot_id };
        break;
      case 'browser_wait_for':
        action = 'WAIT_FOR';
        payload = {
          selector: params.selector,
          text: params.text,
          state: params.state || 'visible',
          timeout_seconds: params.timeout_seconds || 10
        };
        break;
      case 'browser_upload_file':
        action = 'UPLOAD_FILE';
        payload = {
          id: params.element_id,
          filename: params.filename,
          mimeType: params.mimeType,
          base64: params.base64,
          snapshot_id: params.snapshot_id
        };
        break;
      case 'browser_get_storage':
        action = 'GET_STORAGE';
        payload = {
          type: params.type || 'all',
          keys: params.keys
        };
        break;
      case 'browser_evaluate':
        action = 'EVALUATE';
        payload = {
          expression: params.expression
        };
        break;
      case 'browser_fill_form':
        action = 'FILL_FORM';
        payload = {
          fields: params.fields,
          snapshot_id: params.snapshot_id
        };
        break;
      case 'browser_get_network_logs':
        action = 'GET_NETWORK_LOGS';
        payload = {
          url_pattern: params.url_pattern,
          method: params.method,
          status_code: params.status_code,
          limit: params.limit
        };
        break;
      default:
        return { error: `不支持的方法: ${method}` };
    }

    // 固定发给主框架（frameId: 0）：content.js 本身会递归穿透同源 iframe，
    // 若广播给所有 frame，空白子框架会抢先响应，导致快照返回 about:blank / 0 个元素。
    const response = await chrome.tabs.sendMessage(targetTab.id, { action, payload }, { frameId: 0 });
    if (!response || !response.success) {
      return { error: response?.error || '操作执行失败' };
    }

    return { result: response.data ?? response.text ?? response.message ?? '操作成功' };
  } catch (err) {
    return { error: `执行失败 (${method} on Tab ${targetTab.id}): ${err.message}` };
  }
}

/**
 * 广播当前 Tab 详情给 SidePanel
 */
async function broadcastActiveTabInfo() {
  const targetTab = await resolveTargetTab().catch(() => null);
  if (targetTab) {
    activeControlledTab = targetTab;
    notifySidePanel({
      type: 'TAB_INFO',
      tab: {
        id: targetTab.id,
        window_id: targetTab.windowId,
        is_ai_window: targetTab.windowId === aiWindowId,
        title: targetTab.title,
        url: targetTab.url,
        favIconUrl: targetTab.favIconUrl,
        is_bound: targetTab.id === boundTabId
      },
      boundTabId,
      aiWindowId
    });
  }
}

/**
 * 向 SidePanel 发送状态更新
 */
function notifySidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// 监听 AI 专属窗口关闭事件
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === aiWindowId) {
    aiWindowId = null;
    broadcastActiveTabInfo();
  }
});

// 图标点击 -> 打开 SidePanel
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// 监听 Tab 切换与更新
chrome.tabs.onActivated.addListener(() => { broadcastActiveTabInfo(); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') broadcastActiveTabInfo();
});

// 内部消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SELECTION_CHANGED') {
    lastSelectedText = msg.text;
    notifySidePanel({ type: 'SELECTION_CHANGED', text: msg.text });
  } else if (msg.type === 'GET_INITIAL_STATE') {
    sendResponse({
      status: socket && socket.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
      port: currentPort,
      selection: lastSelectedText,
      tab: activeControlledTab,
      boundTabId,
      aiWindowId
    });
  } else if (msg.type === 'SET_PORT') {
    if (!Number.isInteger(msg.port) || msg.port < 1 || msg.port > 65535) {
      sendResponse({ success: false, error: '请输入有效端口（1–65535）' });
      return false;
    }
    currentPort = msg.port;
    chrome.storage.local.set({ bridgePort: currentPort });
    connectBridge(true);
    sendResponse({ success: true });
  } else if (msg.type === 'RECONNECT') {
    connectBridge(true);
    sendResponse({ success: true });
  } else if (msg.type === 'RELOAD_EXTENSION') {
    if (activeControlledTab && activeControlledTab.id) {
      chrome.tabs.reload(activeControlledTab.id).catch(() => {});
    }
    setTimeout(() => {
      try { chrome.runtime.reload(); } catch {}
    }, 100);
    sendResponse({ success: true });
  } else if (msg.type === 'TOGGLE_TAB_LOCK') {
    if (boundTabId) {
      boundTabId = null;
    } else if (activeControlledTab && activeControlledTab.id) {
      boundTabId = activeControlledTab.id;
    }
    if (displayedSessionId) {
      sessions.set(displayedSessionId, { boundTabId, aiWindowId });
      chrome.storage.session.set({ sessions: Object.fromEntries(sessions) });
    }
    broadcastActiveTabInfo();
    sendResponse({ success: true, boundTabId });
  }
  return true;
});
