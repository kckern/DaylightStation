/**
 * Session File Transport
 *
 * Writes log events to per-app session files in media/logs/{app}/.
 * Sessions are bounded by session-log.start events.
 *
 * Old files are pruned at init AND on a recurring timer thereafter. The timer
 * is what makes maxAgeDays mean what it says: pruning only at init gave a
 * retention window of "maxAgeDays as of the last container restart", so a
 * process that stayed up for a month kept a month of logs while claiming to
 * keep three days. Retention has to be a property of the running server, not
 * of how recently someone redeployed.
 */

import fs from 'fs';
import path from 'path';

let instance = null;
let pruneTimer = null;

/** How often the recurring prune runs. Daily: retention is measured in days. */
const DEFAULT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Initialize the session file transport singleton
 * @param {Object} options
 * @param {string} options.baseDir - Base directory for session logs (e.g., media/logs)
 * @param {number} options.maxAgeDays - Delete files older than this (default: 3)
 * @param {number} options.pruneIntervalMs - How often to re-prune (default: 24h)
 */
export function initSessionFileTransport({ baseDir, maxAgeDays = 3, pruneIntervalMs = DEFAULT_PRUNE_INTERVAL_MS }) {
  if (!baseDir) {
    throw new Error('Session file transport requires a baseDir option');
  }

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  pruneOldFiles(baseDir, maxAgeDays);

  // A re-init (tests, a reconfigure) must not leave the previous schedule
  // running against a directory this instance no longer owns.
  clearPruneTimer();
  pruneTimer = setInterval(() => pruneOldFiles(baseDir, maxAgeDays), pruneIntervalMs);
  // Housekeeping must never be the reason the process refuses to exit. The
  // optional call covers hosts where setInterval hands back a plain numeric
  // handle rather than Node's Timeout object.
  pruneTimer?.unref?.();

  // Map<app, { filePath, fd }> — uses file descriptors for synchronous writes
  const activeSessions = new Map();

  const openSession = (app, ts) => {
    const existing = activeSessions.get(app);
    if (existing?.fd != null) {
      try { fs.closeSync(existing.fd); } catch { /* ignore */ }
    }

    const appDir = path.join(baseDir, app);
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }

    const timestamp = ts || new Date().toISOString();
    const safeName = timestamp.replace(/:/g, '-').replace(/\.\d+Z?$/, '');
    const filePath = path.join(appDir, `${safeName}.jsonl`);

    const fd = fs.openSync(filePath, 'a');
    activeSessions.set(app, { filePath, fd });

    return { filePath, fd };
  };

  instance = {
    // Note: uses write() rather than send() because this transport is invoked
    // directly from ingestion, not registered with the dispatcher.
    write(event) {
      const app = event?.context?.app;
      if (!app || !event?.context?.sessionLog) return;

      if (event.event === 'session-log.start') {
        const session = openSession(app, event.ts);
        const line = JSON.stringify(event) + '\n';
        fs.writeSync(session.fd, line);
        return;
      }

      if (!activeSessions.has(app)) {
        openSession(app, event.ts);
      }

      const session = activeSessions.get(app);
      if (session?.fd != null) {
        const line = JSON.stringify(event) + '\n';
        fs.writeSync(session.fd, line);
      }
    },

    flush() {
      for (const [, session] of activeSessions) {
        if (session.fd != null) {
          try { fs.closeSync(session.fd); } catch { /* ignore */ }
          session.fd = null;
        }
      }
      activeSessions.clear();
    },

    getStatus() {
      const sessions = {};
      for (const [app, session] of activeSessions) {
        sessions[app] = { filePath: session.filePath, writable: session.fd != null };
      }
      return { name: 'session-file', baseDir, maxAgeDays, pruneIntervalMs, sessions };
    }
  };

  return instance;
}

export function getSessionFileTransport() {
  return instance;
}

export function resetSessionFileTransport() {
  if (instance) {
    instance.flush();
  }
  clearPruneTimer();
  instance = null;
}

function clearPruneTimer() {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

function pruneOldFiles(baseDir, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  let appDirs;
  try {
    appDirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return;
  }

  for (const appName of appDirs) {
    const appDir = path.join(baseDir, appName);
    let files;
    try {
      files = fs.readdirSync(appDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(appDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore stat/unlink errors
      }
    }
  }
}

export default getSessionFileTransport;
