/**
 * btScan — the Bluetooth screen's nearby-device search, driven from the bus.
 *
 * `bt.scan.request { requestId, action: 'start'|'stop', durationMs }` starts or
 * stops `bt_scan_helper.py`. Each line it prints is relayed as
 * `bt.scan.progress { requestId, ... }`:
 *
 *   scanning {durationMs} → nearby {devices}* → done {reason}
 *
 * The search never pairs, never registers an agent and never removes
 * anything. One search runs at a time: a new start stops the old one, and the
 * pairing window stops it before it opens (server.mjs passes stopScanWindow
 * to handleBtPairRequest), so only one BlueZ client drives discovery.
 * `onWindow(open)` lets the server pause the reconnect loop (not the
 * inventory poll) while a search runs.
 */
import { spawn as nodeSpawn } from 'child_process';
import { fileURLToPath } from 'url';
import { parseHelperLine } from './btPairing.mjs';

const HELPER_PATH = fileURLToPath(new URL('./bt_scan_helper.py', import.meta.url));
export const SCAN_DEFAULT_MS = 60000;
const SCAN_MIN_MS = 5000;
const SCAN_MAX_MS = 120000;

function defaultSpawnHelper(argJson) {
  return nodeSpawn('python3', [HELPER_PATH, argJson], { stdio: ['ignore', 'pipe', 'pipe'] });
}

const KILL_GRACE_MS = 5000;

let active = null; // { requestId, child, closed, close }
// Bumped by every start and every applying stop: a start that finds the
// generation moved on while it waited for the old helper to exit bails, so
// two starts racing one stop never spawn two helpers.
let generation = 0;
let latestStartId; // requestId of the newest start, for `stop` matching

export function isScanWindowOpen() {
  return active !== null;
}

/**
 * Stop the running search, if any. Resolves once its helper has exited; a
 * helper that ignores SIGTERM gets SIGKILL after `graceMs`, and the window is
 * closed anyway shortly after that so a stop never hangs.
 */
export function stopScanWindow({ graceMs = KILL_GRACE_MS } = {}) {
  if (!active) return Promise.resolve();
  const entry = active;
  const { child, closed } = entry;
  try { child.kill?.('SIGTERM'); } catch { /* already gone */ }
  if (!entry.killTimer) {
    entry.killTimer = setTimeout(() => {
      try { child.kill?.('SIGKILL'); } catch { /* already gone */ }
      entry.forceTimer = setTimeout(() => entry.close('stopped'), Math.min(graceMs, 1000));
    }, graceMs);
  }
  return closed;
}

function startScanWindow({ spawnHelper, durationMs, send, logger, requestId, onWindow }) {
  const progress = (extra) => {
    try { send?.('bt.scan.progress', { requestId, ...extra }); }
    catch (err) { logger?.error?.(`❌ bt.scan.progress send failed: ${err?.message}`); }
  };
  let doneSent = false;
  const finish = (extra) => {
    if (doneSent) return;
    doneSent = true;
    progress({ phase: 'done', ...extra });
  };

  let child;
  try {
    child = spawnHelper(JSON.stringify({ durationMs }));
  } catch (err) {
    logger?.error?.(`❌ bt.scan helper failed to start: ${err?.message}`);
    finish({ reason: 'helper-failed' });
    return;
  }
  let resolveClosed;
  const entry = { requestId, child, closed: new Promise((r) => { resolveClosed = r; }) };
  active = entry;
  try { onWindow?.(true); } catch { /* best-effort */ }

  let buf = '';
  let lastCount = -1;
  child.stdout?.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const ev = parseHelperLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (!ev) continue;
      if (ev.phase === 'done') {
        const { phase: _p, ...rest } = ev;
        finish(rest);
        continue;
      }
      if (ev.phase === 'nearby') {
        const n = Array.isArray(ev.devices) ? ev.devices.length : 0;
        if (n !== lastCount) {
          lastCount = n;
          logger?.info?.(`🎮 bt.scan nearby ${n} (requestId=${requestId})`);
        }
      } else {
        logger?.info?.(`🎮 bt.scan ${ev.phase}${ev.message ? ` — ${ev.message}` : ''}`);
      }
      progress(ev);
    }
  });
  child.stderr?.on('data', (chunk) => {
    const s = chunk.toString().trim();
    if (s) logger?.warn?.(`⚠️  bt.scan helper stderr: ${s.slice(0, 500)}`);
  });
  let closedOnce = false;
  const close = (reason) => {
    if (closedOnce) return;
    closedOnce = true;
    clearTimeout(entry.killTimer);
    clearTimeout(entry.forceTimer);
    finish({ reason });
    if (active === entry) active = null;
    try { onWindow?.(false); } catch { /* best-effort */ }
    resolveClosed();
  };
  entry.close = close;
  child.on?.('error', (err) => {
    logger?.error?.(`❌ bt.scan helper failed: ${err?.message}`);
    close('helper-failed');
  });
  child.on?.('close', (code, signal) => close(code === 0 || signal ? 'stopped' : 'helper-crashed'));
}

/**
 * Bus entry point for `bt.scan.request`. Never throws.
 *
 * @param {object} message  { requestId, action, durationMs }
 * @param {object} deps     { spawnHelper, send, logger, isPairingOpen, onWindow }
 */
export async function handleBtScanRequest(message, {
  spawnHelper = defaultSpawnHelper, send, logger = console, isPairingOpen = () => false, onWindow,
} = {}) {
  const requestId = message?.requestId;
  if (message?.action === 'stop') {
    // Stop only the search this requestId started (or anything, with none),
    // so a stale page cannot end another page's search.
    const applies = requestId == null || requestId === active?.requestId || requestId === latestStartId;
    if (!applies) {
      logger?.info?.(`🎮 bt.scan stop ignored (requestId=${requestId}, running=${active?.requestId ?? '-'})`);
      return;
    }
    logger?.info?.(`🎮 bt.scan stop (requestId=${requestId})`);
    generation += 1;
    await stopScanWindow();
    return;
  }
  const refuseBusy = () => {
    logger?.warn?.(`⚠️  bt.scan.request ${requestId} refused — pairing window open`);
    try { send?.('bt.scan.progress', { requestId, phase: 'done', reason: 'busy' }); } catch { /* best-effort */ }
  };
  if (isPairingOpen()) return refuseBusy();
  const durationMs = Math.min(Math.max(Number(message?.durationMs) || SCAN_DEFAULT_MS, SCAN_MIN_MS), SCAN_MAX_MS);
  const mine = ++generation;
  latestStartId = requestId;
  await stopScanWindow();
  if (mine !== generation) {
    logger?.info?.(`🎮 bt.scan.request ${requestId} superseded before it started`);
    return;
  }
  // A pairing window may have opened while the old search was stopping.
  if (isPairingOpen()) return refuseBusy();
  logger?.info?.(`🎮 bt.scan.request received (requestId=${requestId}, durationMs=${durationMs})`);
  startScanWindow({ spawnHelper, durationMs, send, logger, requestId, onWindow });
}
