// background.js - Browser Agent Background Service Worker (Multi-Tab & Dedicated AI Window Isolation)
let socket = null;
let currentPort = 3088;
let lastSelectedText = '';
let activeControlledTab = null;
let boundTabId = null;   // 锁定的专属后台工作 Tab ID
let aiWindowId = null;   // AI 专属独立工作窗口 ID（与用户主窗口彻底物理隔离）

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
function connectBridge() {
  if (socket) {
    if (socket.readyState === WebSocket.OPEN) return;
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

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'PING' || msg.type === 'PONG') return;

        console.log('[BrowserAgent] Received command:', msg);
        notifySidePanel({ type: 'AUDIT_LOG', log: msg });

        const { id, method, params } = msg;
        const response = await handleBridgeCommand(method, params || {});
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            id,
            result: response.result || null,
            error: response.error || null
          }));
        }
      } catch (err) {
        console.error('[BrowserAgent] Message processing error:', err);
      }
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
async function ensureAiWindow(url, makeActive = false) {
  if (aiWindowId) {
    try {
      const win = await chrome.windows.get(aiWindowId, { populate: true });
      if (win) {
        // 在已有的 AI 专属窗口中打开新标签页
        const newTab = await chrome.tabs.create({
          windowId: aiWindowId,
          url,
          active: makeActive
        });
        return { tab: newTab, isNewWindow: false, windowId: aiWindowId };
      }
    } catch (e) {
      aiWindowId = null;
    }
  }

  // 创建全新的 AI 专属独立窗口（focused: makeActive，默认 false，不抢夺用户焦点）
  const newWin = await chrome.windows.create({
    url,
    focused: makeActive,
    state: 'normal'
  });
  aiWindowId = newWin.id;
  const newTab = newWin.tabs && newWin.tabs[0] ? newWin.tabs[0] : (await chrome.tabs.query({ windowId: newWin.id }))[0];
  return { tab: newTab, isNewWindow: true, windowId: newWin.id };
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
  }

  // 2. 如果当前有锁定的后台 Tab
  if (boundTabId) {
    try {
      const tab = await chrome.tabs.get(boundTabId);
      if (tab) return tab;
    } catch (e) {
      boundTabId = null;
      notifySidePanel({ type: 'TAB_LOCK_CHANGED', boundTabId: null });
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

  return activeControlledTab;
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
 * 处理来自 Bridge Server 的指令
 */
async function handleBridgeCommand(method, params) {
  // ── 1. 窗口与多标签页管理类命令 ──
  if (method === 'browser_create_window') {
    let url = params.url || 'https://www.bing.com';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const makeActive = params.focused === true;
    const { tab, windowId } = await ensureAiWindow(url, makeActive);
    
    boundTabId = tab.id;
    notifySidePanel({ type: 'TAB_LOCK_CHANGED', boundTabId: tab.id });
    await new Promise((r) => setTimeout(r, 1500));

    return {
      result: {
        window_id: windowId,
        tab_id: tab.id,
        url,
        message: `已创建/获取 AI 专属独立工作窗口 (Window ID: ${windowId}, Tab ID: ${tab.id})，绝不干扰用户主窗口！`
      }
    };
  }

  if (method === 'browser_close_window') {
    if (aiWindowId) {
      const winId = aiWindowId;
      try {
        await chrome.windows.remove(winId);
      } catch (e) {}
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

    await new Promise((r) => setTimeout(r, 1500));

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

  if (method === 'browser_close_tab') {
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

  // ── 2. 页面级信息与跳转命令 ──
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
    await chrome.tabs.update(targetTab.id, { url });
    await new Promise((r) => setTimeout(r, 1200));
    return { result: { message: `标签页 [${targetTab.id}] 已跳转至: ${url}` } };
  }

  // ── 3. 派发给 Content Script 的 DOM 操作 ──
  try {
    await ensureContentScriptInjected(targetTab.id);

    let action = '';
    let payload = {};

    switch (method) {
      case 'browser_snapshot':
        action = 'SNAPSHOT';
        break;
      case 'browser_click':
        action = 'CLICK';
        payload = { id: params.element_id };
        break;
      case 'browser_type':
        action = 'TYPE';
        payload = {
          id: params.element_id,
          text: params.text,
          clearFirst: params.clear_first !== false
        };
        break;
      case 'browser_press':
        action = 'PRESS';
        payload = { key: params.key };
        break;
      case 'browser_scroll':
        action = 'SCROLL';
        payload = { direction: params.direction || 'down', amount: params.amount || 500 };
        break;
      case 'browser_get_text':
        action = 'GET_TEXT';
        payload = { id: params.element_id };
        break;
      default:
        return { error: `不支持的方法: ${method}` };
    }

    const response = await chrome.tabs.sendMessage(targetTab.id, { action, payload });
    if (!response || !response.success) {
      return { error: response?.error || '操作执行失败' };
    }

    return { result: response.data || response.text || response.message || '操作成功' };
  } catch (err) {
    return { error: `执行失败 (${method} on Tab ${targetTab.id}): ${err.message}` };
  }
}

/**
 * 广播当前 Tab 详情给 SidePanel
 */
async function broadcastActiveTabInfo() {
  const targetTab = await resolveTargetTab();
  if (targetTab) {
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
    boundTabId = null;
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
    currentPort = msg.port;
    chrome.storage.local.set({ bridgePort: currentPort });
    connectBridge();
    sendResponse({ success: true });
  } else if (msg.type === 'RECONNECT') {
    connectBridge();
    sendResponse({ success: true });
  } else if (msg.type === 'TOGGLE_TAB_LOCK') {
    if (boundTabId) {
      boundTabId = null;
    } else if (activeControlledTab && activeControlledTab.id) {
      boundTabId = activeControlledTab.id;
    }
    broadcastActiveTabInfo();
    sendResponse({ success: true, boundTabId });
  }
  return true;
});
