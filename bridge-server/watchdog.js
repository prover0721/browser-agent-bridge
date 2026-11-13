const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const BRIDGE_DIR = __dirname;
const SCRIPT_PATH = path.join(BRIDGE_DIR, 'dist', 'index.js');
const LOG_PATH = path.join(BRIDGE_DIR, 'daemon.log');
const PID_PATH = path.join(BRIDGE_DIR, 'watchdog.pid');
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 3088);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    }
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
}

function acquirePidLock() {
  try {
    if (fs.existsSync(PID_PATH)) {
      const oldPid = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
      if (oldPid && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          log(`Another watchdog instance (PID ${oldPid}) is already running. Exiting duplicate.`);
          process.exit(0);
        } catch {
          // Stale PID file, safe to overwrite
        }
      }
    }
    fs.writeFileSync(PID_PATH, String(process.pid), 'utf8');
  } catch (err) {
    log(`PID lock warning: ${err.message}`);
  }
}

function releasePidLock() {
  try {
    if (fs.existsSync(PID_PATH)) {
      const cur = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
      if (cur === process.pid) fs.unlinkSync(PID_PATH);
    }
  } catch {}
}

let child = null;
let isShuttingDown = false;
let lastSpawnTime = 0;
let consecutiveProbeFailures = 0;

function probeBridgePort() {
  return new Promise(resolve => {
    const sock = net.createConnection({ host: '127.0.0.1', port: BRIDGE_PORT, timeout: 2000 });
    let settled = false;
    const done = ok => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch {}
      resolve(ok);
    };
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

function startDaemon() {
  if (isShuttingDown) return;
  if (child && !child.killed) return;

  lastSpawnTime = Date.now();
  consecutiveProbeFailures = 0;
  log(`Starting Browser Agent Bridge Master Daemon on port ${BRIDGE_PORT}...`);

  try {
    child = spawn(process.execPath, [SCRIPT_PATH], {
      cwd: BRIDGE_DIR,
      env: { ...process.env, BRIDGE_DAEMON: '1', BRIDGE_PORT: String(BRIDGE_PORT) },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    child.stdout?.on('data', data => log(`[STDOUT] ${data.toString().trim()}`));
    child.stderr?.on('data', data => log(`[STDERR] ${data.toString().trim()}`));

    child.on('error', err => {
      log(`Child process error: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      log(`Daemon process exited (code: ${code}, signal: ${signal}). Re-spawning in 2s...`);
      child = null;
      if (!isShuttingDown) {
        setTimeout(startDaemon, 2000);
      }
    });
  } catch (err) {
    log(`Failed to spawn daemon: ${err.message}`);
    setTimeout(startDaemon, 3000);
  }
}

// 守护定时心跳 + 端口活跃探测，确保事件循环永不退出并检测假死进程
setInterval(async () => {
  if (isShuttingDown) return;
  if (!child || child.killed) {
    log('Heartbeat check: Daemon process is not running, restarting...');
    startDaemon();
    return;
  }
  if (Date.now() - lastSpawnTime < 15000) return;

  const healthy = await probeBridgePort();
  if (healthy) {
    consecutiveProbeFailures = 0;
  } else {
    consecutiveProbeFailures += 1;
    log(`Health probe failed on 127.0.0.1:${BRIDGE_PORT} (${consecutiveProbeFailures}/3)`);
    if (consecutiveProbeFailures >= 3) {
      log('Daemon unresponsive after 3 consecutive probes. Killing and restarting...');
      try { child.kill(); } catch {}
      child = null;
      consecutiveProbeFailures = 0;
      startDaemon();
    }
  }
}, 10000);

process.on('uncaughtException', err => {
  log(`Watchdog uncaught exception: ${err.message}`);
});

function shutdown() {
  isShuttingDown = true;
  releasePidLock();
  if (child) {
    try { child.kill(); } catch {}
  }
  process.exit(0);
}

process.on('exit', releasePidLock);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

acquirePidLock();
startDaemon();
