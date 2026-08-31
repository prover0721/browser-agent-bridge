// sidepanel.js - Side Panel Logic
document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('statusBadge');
  const portInput = document.getElementById('portInput');
  const btnReconnect = document.getElementById('btnReconnect');
  const tabTitle = document.getElementById('tabTitle');
  const tabUrl = document.getElementById('tabUrl');
  const selectionText = document.getElementById('selectionText');
  const btnCopyQuote = document.getElementById('btnCopyQuote');
  const btnSnapshot = document.getElementById('btnSnapshot');
  const auditLogs = document.getElementById('auditLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');
  const snapshotModal = document.getElementById('snapshotModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const snapshotContent = document.getElementById('snapshotContent');

  let currentSelectedText = '';

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

  // 更新标签页信息
  function updateTabInfo(tab) {
    if (!tab) return;
    tabTitle.textContent = tab.title || '无标题';
    tabUrl.textContent = tab.url || '';
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
    if (res.tab) updateTabInfo(res.tab);
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
      updateTabInfo(msg.tab);
    } else if (msg.type === 'SELECTION_CHANGED') {
      currentSelectedText = msg.text;
      selectionText.textContent = msg.text;
    } else if (msg.type === 'AUDIT_LOG') {
      appendAuditLog(msg.log);
    }
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { action: 'SNAPSHOT' }, (res) => {
      if (chrome.runtime.lastError || !res || !res.success) {
        alert('无法获取当前页面快照，请确保页面已加载完成且非受保护系统页。');
        return;
      }
      snapshotContent.textContent = res.data;
      snapshotModal.classList.remove('hidden');
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
