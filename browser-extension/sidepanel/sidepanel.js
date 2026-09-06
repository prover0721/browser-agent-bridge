// sidepanel.js - Side Panel Logic (Multi-Tab & Background Locking)
document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('statusBadge');
  const portInput = document.getElementById('portInput');
  const btnReconnect = document.getElementById('btnReconnect');
  const tabTitle = document.getElementById('tabTitle');
  const tabUrl = document.getElementById('tabUrl');
  const lockBadge = document.getElementById('lockBadge');
  const btnToggleLock = document.getElementById('btnToggleLock');
  const selectionText = document.getElementById('selectionText');
  const btnCopyQuote = document.getElementById('btnCopyQuote');
  const btnSnapshot = document.getElementById('btnSnapshot');
  const auditLogs = document.getElementById('auditLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');
  const snapshotModal = document.getElementById('snapshotModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const snapshotContent = document.getElementById('snapshotContent');

  let currentSelectedText = '';
  let isCurrentlyBound = false;

  // 更新连接状态徽标
  function updateStatus(status, port) {
    statusBadge.className = 'badge ' + status;
    const textSpan = statusBadge.querySelector('.text');
    if (status === 'connected') {
      textSpan.textContent = `已连接 (:${port})`;
    } else if (status === 'connecting') {
      textSpan.textContent = `连接中...`;
    } else {
      textSpan.textContent = `未连接`;
    }
  }

  // 更新锁定状态
  function updateLockState(isBound) {
    isCurrentlyBound = !!isBound;
    if (isCurrentlyBound) {
      lockBadge.className = 'mode-badge locked';
      lockBadge.textContent = '📌 后台锁定模式';
      btnToggleLock.textContent = '🔓 解除锁定 (恢复跟随前台)';
      btnToggleLock.style.borderColor = '#8b5cf6';
    } else {
      lockBadge.className = 'mode-badge follow';
      lockBadge.textContent = '👀 自动跟随前台';
      btnToggleLock.textContent = '📌 锁定当前页为后台工作区';
      btnToggleLock.style.borderColor = '';
    }
  }

  // 更新标签页信息
  function updateTabInfo(tab, boundTabId) {
    if (!tab) return;
    tabTitle.textContent = (boundTabId === tab.id ? '📌 ' : '') + (tab.title || '无标题');
    tabUrl.textContent = tab.url || '';
    updateLockState(boundTabId && boundTabId === tab.id);
  }

  // 添加审计日志
  function appendAuditLog(log) {
    const emptyNotice = auditLogs.querySelector('.log-empty');
    if (emptyNotice) emptyNotice.remove();

    const item = document.createElement('div');
    item.className = 'log-item';
    const time = new Date().toLocaleTimeString();
    item.textContent = `[${time}] ${log.method || 'COMMAND'}: ${JSON.stringify(log.params || {})}`;
    auditLogs.prepend(item);
  }

  // 初始化加载状态
  chrome.runtime.sendMessage({ type: 'GET_INITIAL_STATE' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    if (res.port) portInput.value = res.port;
    if (res.status) updateStatus(res.status, res.port);
    if (res.tab) updateTabInfo(res.tab, res.boundTabId);
    updateLockState(!!res.boundTabId);
    if (res.selection) {
      currentSelectedText = res.selection;
      selectionText.textContent = res.selection;
    }
  });

  // 监听来自 Background 的通知
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATUS_CHANGE') {
      updateStatus(msg.status, msg.port);
    } else if (msg.type === 'TAB_INFO') {
      updateTabInfo(msg.tab, msg.boundTabId);
    } else if (msg.type === 'TAB_LOCK_CHANGED') {
      updateLockState(!!msg.boundTabId);
    } else if (msg.type === 'SELECTION_CHANGED') {
      currentSelectedText = msg.text;
      selectionText.textContent = msg.text;
    } else if (msg.type === 'AUDIT_LOG') {
      appendAuditLog(msg.log);
    }
  });

  // 切换锁定/跟随按钮
  btnToggleLock.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_TAB_LOCK' }, (res) => {
      if (res && res.success) {
        updateLockState(!!res.boundTabId);
      }
    });
  });

  // 重连按钮
  btnReconnect.addEventListener('click', () => {
    const port = parseInt(portInput.value, 10) || 3088;
    chrome.runtime.sendMessage({ type: 'SET_PORT', port }, () => {
      updateStatus('connecting', port);
    });
  });

  // 复制划词引用
  btnCopyQuote.addEventListener('click', () => {
    if (!currentSelectedText) {
      alert('请先在网页中选中文本');
      return;
    }
    const quote = `[网页引用片段]:\n"${currentSelectedText}"`;
    navigator.clipboard.writeText(quote).then(() => {
      const originalText = btnCopyQuote.textContent;
      btnCopyQuote.textContent = '已复制到剪贴板！';
      setTimeout(() => { btnCopyQuote.textContent = originalText; }, 1500);
    });
  });

  // 预览快照按钮
  btnSnapshot.addEventListener('click', async () => {
    chrome.runtime.sendMessage({ type: 'GET_INITIAL_STATE' }, async (state) => {
      const targetTabId = state?.boundTabId;
      let activeTab = null;
      if (targetTabId) {
        try { activeTab = await chrome.tabs.get(targetTabId); } catch (e) {}
      }
      if (!activeTab) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTab = tab;
      }
      if (!activeTab) return;

      chrome.tabs.sendMessage(activeTab.id, { action: 'SNAPSHOT' }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          alert('无法获取当前页面快照，请确保页面已加载完成且非受保护系统页。');
          return;
        }
        snapshotContent.textContent = res.data;
        snapshotModal.classList.remove('hidden');
      });
    });
  });

  // 关闭快照弹窗
  btnCloseModal.addEventListener('click', () => {
    snapshotModal.classList.add('hidden');
  });

  // 清空日志
  btnClearLogs.addEventListener('click', () => {
    auditLogs.innerHTML = '<div class="log-empty">暂无执行记录</div>';
  });
});
