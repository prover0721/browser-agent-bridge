const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BRIDGE_DIR = __dirname;
const SCRIPT_PATH = path.join(BRIDGE_DIR, 'dist', 'index.js');
const LOG_PATH = path.join(BRIDGE_DIR, 'daemon.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    }
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
}

let child = null;
let isShuttingDown = false;

function startDaemon() {
  if (isShuttingDown) return;
  if (child && !child.killed) return;

  log('Starting Browser Agent Bridge Master Daemon on port 3088...');

  try {
    child = spawn(process.execPath, [SCRIPT_PATH], {
      cwd: BRIDGE_DIR,
      env: { ...process.env, BRIDGE_DAEMON: '1', BRIDGE_PORT: '3088' },
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

// 守护定时心跳，确保事件循环永不退出并定期检查子进程状态
setInterval(() => {
  if (isShuttingDown) return;
  if (!child || child.killed) {
    log('Heartbeat check: Daemon process is not running, restarting...');
    startDaemon();
  }
}, 10000);

process.on('uncaughtException', err => {
  log(`Watchdog uncaught exception: ${err.message}`);
});

process.on('SIGINT', () => { isShuttingDown = true; if (child) child.kill(); process.exit(0); });
process.on('SIGTERM', () => { isShuttingDown = true; if (child) child.kill(); process.exit(0); });

startDaemon();
