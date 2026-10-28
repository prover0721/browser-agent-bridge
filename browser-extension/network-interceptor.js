// network-interceptor.js - In-page Main-World Network Hook for Browser Agent Bridge
(function () {
  if (typeof window === 'undefined' || window.__BROWSER_AGENT_NETWORK_HOOKED__) return;
  window.__BROWSER_AGENT_NETWORK_HOOKED__ = true;

  const MAX_BODY_LEN = 100 * 1024; // 100KB max preview per response

  function safeClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return String(obj);
    }
  }

  function emitEntry(entry) {
    try {
      window.postMessage({ type: '__BROWSER_AGENT_NETWORK_LOG__', entry: safeClone(entry) }, '*');
    } catch {}
  }

  // 0. 解除反粘贴、反复制、防右键限制（针对学习通/考试测评系统）
  try {
    const unblockEvents = ['paste', 'copy', 'cut', 'contextmenu', 'selectstart'];
    unblockEvents.forEach((eventType) => {
      window.addEventListener(eventType, (e) => {
        // 标记并允许原生剪贴板与输入行为穿透
        if (e.defaultPrevented && e.__ba_allow_paste) {
          return;
        }
      }, true);
    });
    // 清除页面内联 onpaste / oncopy 拦截
    ['onpaste', 'oncopy', 'oncut', 'oncontextmenu', 'onselectstart'].forEach((prop) => {
      try {
        Object.defineProperty(document, prop, { get: () => null, set: () => {}, configurable: true });
      } catch {}
    });
  } catch {}

  // 1. Hook window.fetch
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const startTime = Date.now();
      let url = '';
      let method = 'GET';
      let requestBody = null;

      try {
        const input = args[0];
        const init = args[1] || {};
        if (typeof input === 'string') {
          url = input;
        } else if (input && typeof input === 'object' && input.url) {
          url = input.url;
          method = input.method || 'GET';
        }
        if (init.method) method = init.method;
        if (init.body) {
          if (typeof init.body === 'string') requestBody = init.body.slice(0, 1000);
          else requestBody = '[Body Object]';
        }
      } catch {}

      try {
        const response = await originalFetch.apply(this, args);
        const durationMs = Date.now() - startTime;
        const status = response.status;
        const contentType = response.headers?.get('content-type') || '';

        // Clone response to read body without consuming the page's stream
        const cloned = response.clone();
        cloned.text().then(text => {
          let responseBody = text;
          if (text.length > MAX_BODY_LEN) {
            responseBody = text.slice(0, MAX_BODY_LEN) + '... [truncated]';
          }
          if (contentType.includes('application/json')) {
            try { responseBody = JSON.parse(text); } catch {}
          }
          emitEntry({
            id: 'fetch_' + Math.random().toString(36).slice(2, 9),
            type: 'fetch',
            url,
            method: method.toUpperCase(),
            status,
            requestBody,
            responseBody,
            durationMs,
            timestamp: startTime
          });
        }).catch(() => {
          emitEntry({
            id: 'fetch_' + Math.random().toString(36).slice(2, 9),
            type: 'fetch',
            url,
            method: method.toUpperCase(),
            status,
            requestBody,
            responseBody: '[Stream / Binary]',
            durationMs,
            timestamp: startTime
          });
        });

        return response;
      } catch (err) {
        emitEntry({
          id: 'fetch_' + Math.random().toString(36).slice(2, 9),
          type: 'fetch',
          url,
          method: method.toUpperCase(),
          status: 0,
          error: err.message,
          durationMs: Date.now() - startTime,
          timestamp: startTime
        });
        throw err;
      }
    };
  }

  // 2. Hook XMLHttpRequest
  if (typeof window.XMLHttpRequest === 'function') {
    const OriginalXHR = window.XMLHttpRequest;
    const proto = OriginalXHR.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;

    proto.open = function (method, url, ...rest) {
      this.__ba_info = {
        method: (method || 'GET').toUpperCase(),
        url: typeof url === 'string' ? url : String(url),
        startTime: Date.now()
      };
      return origOpen.apply(this, [method, url, ...rest]);
    };

    proto.send = function (body) {
      if (this.__ba_info) {
        if (typeof body === 'string') this.__ba_info.requestBody = body.slice(0, 1000);
        else if (body) this.__ba_info.requestBody = '[Body Object]';
        
        this.addEventListener('loadend', () => {
          try {
            const info = this.__ba_info;
            if (!info) return;
            const durationMs = Date.now() - info.startTime;
            let responseBody = null;
            if (this.responseType === '' || this.responseType === 'text') {
              const text = this.responseText || '';
              responseBody = text.length > MAX_BODY_LEN ? text.slice(0, MAX_BODY_LEN) + '... [truncated]' : text;
              try { responseBody = JSON.parse(text); } catch {}
            } else if (this.responseType === 'json') {
              responseBody = this.response;
            } else {
              responseBody = `[${this.responseType || 'binary'}]`;
            }
            emitEntry({
              id: 'xhr_' + Math.random().toString(36).slice(2, 9),
              type: 'xhr',
              url: info.url,
              method: info.method,
              status: this.status,
              requestBody: info.requestBody || null,
              responseBody,
              durationMs,
              timestamp: info.startTime
            });
          } catch {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
