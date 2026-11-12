// offscreen.js - Persistent DOM document keeping MV3 extension pipeline alive 24/7
let keepAlivePort = null;

function connectKeepAlivePort() {
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'keep-alive-offscreen' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      setTimeout(connectKeepAlivePort, 1000);
    });
    keepAlivePort.onMessage.addListener((msg) => {
      if (msg && msg.type === 'PING') {
        keepAlivePort.postMessage({ type: 'PONG', timestamp: Date.now() });
      }
    });
  } catch (err) {
    setTimeout(connectKeepAlivePort, 2000);
  }
}

// 维持高频心跳，彻底免疫 Edge / Chrome 后台空闲休眠
setInterval(() => {
  if (keepAlivePort) {
    try {
      keepAlivePort.postMessage({ type: 'HEARTBEAT', timestamp: Date.now() });
    } catch {
      connectKeepAlivePort();
    }
  } else {
    connectKeepAlivePort();
  }
}, 15000);

connectKeepAlivePort();
