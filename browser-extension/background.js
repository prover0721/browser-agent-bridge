// background.js - Browser Agent Background Service Worker
let socket = null;
let isConnecting = false;
let currentPort = 3088;
let lastSelectedText = '';
let activeControlledTab = null;

// 从 storage 加载配置端口
chrome.storage.local.get(['bridgePort'], (res) => {
  if (res.bridgePort) currentPort = res.bridgePort;
  connectBridge();
});

/**
 * 建立与本地 MCP 桥接服务的 WebSocket 连接
 */
function connectBridge() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  isConnecting = true;
  notifySidePanel({ type: 'STATUS_CHANGE', status: 'connecting', port: currentPort });

  try {
    socket = new WebSocket(`ws://127.0.0.1:${currentPort}/ws`);

    socket.onopen = () => {
      console.log(`[BrowserAgent] Connected to Bridge Server on port ${currentPort}`);
      isConnecting = false;
      notifySidePanel({ type: 'STATUS_CHANGE', status: 'connected', port: currentPort });
      broadcastActiveTabInfo();
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[BrowserAgent] Received command:', msg);
        notifySidePanel({ type: 'AUDIT_LOG', log: msg });

        const { id, method, params } = msg;
        const response = await handleBridgeCommand(method, params || {});
        
        // 将执行结果回传给 Bridge Server
        socket.send(JSON.stringify({
          id,
          result: response.result || null,
          error: response.error || null
        }));
      } catch (err) {
        console.error('[BrowserAgent] Message processing error:', err);
      }
    };

    socket.onclose = () => {
      console.log('[BrowserAgent] Disconnected from Bridge. Will retry in 3s...');
      isConnecting = false;
      notifySidePanel({ type: 'STATUS_CHANGE', status: 'disconnected', port: currentPort });
      setTimeout(connectBridge, 3000);
    };

    socket.onerror = (err) => {
      console.warn('[BrowserAgent] WebSocket error:', err);
      socket.close();
    };
  } catch (err) {
    isConnecting = false;
    notifySidePanel({ type: 'STATUS_CHANGE', status: 'disconnected', port: currentPort });
    setTimeout(connectBridge, 3000);
  }
}

/**
 * 获取当前用户的活动受控标签页
 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('edge://')) {
    activeControlledTab = tab;
    return tab;
  }
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
    // 等待脚本初始化
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * 处理来自 Bridge Server 的指令
 */
async function handleBridgeCommand(method, params) {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    return { error: '当前没有可用的活动浏览器标签页，请先打开一个常规网页。' };
  }

  // 1. 直接由 Background 处理的导航/页面级别命令
  if (method === 'browser_get_active_tab') {
    return {
      result: {
        tabId: tab.id,
        title: tab.title,
        url: tab.url
      }
    };
  }

  if (method === 'browser_navigate') {
    if (!params.url) return { error: '未提供导航目标 URL' };
    let url = params.url;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    await chrome.tabs.update(tab.id, { url });
    // 等待页面开始加载
    await new Promise((r) => setTimeout(r, 1000));
    return { result: { message: `已成功跳转至: ${url}` } };
  }

  // 2. 需要派发给 Content Script 的 DOM 操作
  try {
    await ensureContentScriptInjected(tab.id);

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

    const response = await chrome.tabs.sendMessage(tab.id, { action, payload });
    if (!response || !response.success) {
      return { error: response?.error || '操作执行失败' };
    }

    return { result: response.data || response.text || response.message || '操作成功' };
  } catch (err) {
    return { error: `执行失败 (${method}): ${err.message}` };
  }
}

/**
 * 广播当前 Tab 详情给 SidePanel
 */
async function broadcastActiveTabInfo() {
  const tab = await getActiveTab();
  if (tab) {
    notifySidePanel({
      type: 'TAB_INFO',
      tab: { id: tab.id, title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl }
    });
  }
}

/**
 * 向 SidePanel 发送状态更新
 */
function notifySidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // 侧边栏未打开时忽略错误
  });
}

// 监听图标点击 -> 打开 SidePanel
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// 监听 Tab 切换
chrome.tabs.onActivated.addListener(() => {
  broadcastActiveTabInfo();
});

// 监听 Tab 更新完成
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    broadcastActiveTabInfo();
  }
});

// 接收来自 Content Script 或 SidePanel 的内部消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SELECTION_CHANGED') {
    lastSelectedText = msg.text;
    notifySidePanel({ type: 'SELECTION_CHANGED', text: msg.text });
  } else if (msg.type === 'GET_INITIAL_STATE') {
    sendResponse({
      status: socket && socket.readyState === WebSocket.OPEN ? 'connected' : (isConnecting ? 'connecting' : 'disconnected'),
      port: currentPort,
      selection: lastSelectedText,
      tab: activeControlledTab
    });
  } else if (msg.type === 'SET_PORT') {
    currentPort = msg.port;
    chrome.storage.local.set({ bridgePort: currentPort });
    if (socket) socket.close();
    connectBridge();
    sendResponse({ success: true });
  } else if (msg.type === 'RECONNECT') {
    if (socket) socket.close();
    connectBridge();
    sendResponse({ success: true });
  }
  return true;
});
