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
import { createLogger } from '../logger.mjs';

let instance = null;
let pruneTimer = null;

/**
 * Once per process, not once per transport: the point of the warn below is to
 * be noticed, and a surface that is emitting thousands of untagged events a
 * minute would otherwise turn the diagnosis into its own flood.
 * resetSessionFileTransport clears it, which is what lets tests exercise it.
 */
let warnedAboutSkips = false;

// This transport is invoked directly from ingestion and is NOT registered with
// the dispatcher, so logging through the dispatcher here cannot recurse.
const logger = createLogger({ source: 'backend', app: 'logging', context: { module: 'session-file' } });

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

  // Drop accounting. The gate below discarded every event the piano kiosk ever
  // emitted, for months, without leaving a trace — and during a storm the drop
  // IS the signal. Count by app so the answer to "why is there no log for X"
  // is a number rather than an investigation.
  const skippedByApp = new Map();
  const skippedByReason = new Map();

  const recordSkip = (event) => {
    const app = event?.context?.app;
    // Two different absences, kept apart: an event with no app at all is a
    // logger that was never given an identity, while an event WITH an app but
    // no sessionLog is a surface that logs and simply was not opted in. The
    // second is the one worth chasing; collapsing them hides that.
    const reason = app ? 'not-session-logged' : 'no-app';
    const key = app || '(untagged)';
    skippedByApp.set(key, (skippedByApp.get(key) || 0) + 1);
    skippedByReason.set(reason, (skippedByReason.get(reason) || 0) + 1);

    if (!warnedAboutSkips) {
      warnedAboutSkips = true;
      logger.warn('logging.session-file.untagged', {
        app: key,
        reason,
        droppedEvent: typeof event?.event === 'string' ? event.event : null,
        hint: 'call configure({ context: { app, sessionLog: true } }) in the app that owns this surface',
      });
    }
  };

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
      if (!app || !event?.context?.sessionLog) {
        recordSkip(event);
        return;
      }

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
      let total = 0;
      for (const n of skippedByApp.values()) total += n;
      return {
        name: 'session-file',
        baseDir,
        maxAgeDays,
        pruneIntervalMs,
        sessions,
        skipped: {
          total,
          byApp: Object.fromEntries(skippedByApp),
          byReason: Object.fromEntries(skippedByReason),
          warned: warnedAboutSkips,
        },
      };
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
  warnedAboutSkips = false;
  instance = null;
}

function clearPruneTimer() {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

/**
 * How far below the logs root the pruner will walk.
 *
 * Two levels, because that is the deepest layout a session log is written at:
 * `<app>/*.jsonl` is what this transport produces, and `<app>/<date>/*.jsonl`
 * is the dated variant a nested layout would use. Anything deeper is not a
 * shape any log transport writes — and `media/logs/` is a real media directory
 * holding a camera archive and .webm captures, so an unbounded walk over it
 * with a delete at the end is its own hazard.
 */
const MAX_PRUNE_DEPTH = 2;

/** The only extension this transport ever writes. */
const OWNED_EXTENSION = '.jsonl';

/**
 * Does this file look like something this transport wrote?
 *
 * Extension is not ownership. `media/logs/` also holds
 * `poses/<date>/*.jsonl` (pose-estimation recordings) and
 * `camera-archive/<camera>/<date>.jsonl` (motion events) — both `.jsonl`, and
 * the pose files even share this transport's `<ISO-datetime>.jsonl` filename
 * shape. Deleting either would be data loss, so nested candidates have to
 * prove themselves by content: every line this transport writes is a
 * dispatcher event, which always carries a string `event` and an object
 * `context`. A pose file opens with `{"type":"session_start",...}` and a
 * camera entry with `{"ts":...,"camera":...}`; neither passes.
 *
 * Reads only the head of the file — enough for the first line.
 */
function looksLikeSessionLog(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const firstLine = buf.subarray(0, read).toString('utf8').split('\n')[0];
    if (!firstLine) return false;
    const parsed = JSON.parse(firstLine);
    return typeof parsed?.event === 'string'
      && parsed.context !== null
      && typeof parsed.context === 'object';
  } catch {
    // Unreadable, truncated mid-line, or not JSON: not ours, so leave it.
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * Delete session logs older than maxAgeDays, walking nested layouts.
 *
 * Files sitting directly in the logs root are never touched — `backend.log`
 * and loose screenshots live there and belong to nobody here. Directories are
 * never removed, only files.
 *
 * Entries are classified with `lstat` rather than by the dirent type readdir
 * reports. lstat never follows a symlink, so a link out of the tree is neither
 * descended into nor deleted through; and it does not depend on the
 * filesystem filling in d_type, which some do not — that would leave every
 * entry "unknown", the walk skipping everything, and retention doing nothing
 * while looking like it worked. That failure mode is the reason this tier
 * exists.
 */
function pruneOldFiles(baseDir, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  const walk = (dir, depth) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return; // a directory we cannot read is not worth failing over
    }

    for (const name of names) {
      const full = path.join(dir, name);

      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue; // vanished between readdir and here
      }

      if (stat.isDirectory()) {
        if (depth < MAX_PRUNE_DEPTH) walk(full, depth + 1);
        continue;
      }

      if (!stat.isFile()) continue;             // symlinks, sockets, devices
      if (depth === 0) continue;                // the logs root itself
      if (!name.endsWith(OWNED_EXTENSION)) continue;

      // The flat `<app>/*.jsonl` layout is this transport's own output and has
      // always been pruned on extension alone; keep that. Deeper files are
      // shared ground, so they have to prove ownership first.
      if (depth > 1 && !looksLikeSessionLog(full)) continue;

      if (stat.mtimeMs < cutoff) {
        try {
          fs.unlinkSync(full);
        } catch {
          // A file we cannot remove is not worth failing over
        }
      }
    }
  };

  walk(baseDir, 0);
}

export default getSessionFileTransport;
