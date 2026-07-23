/**
 * Session Events File Transport
 *
 * Writes full-fidelity input telemetry events to per-app `.events` files in
 * media/logs/{app}/. A new file opens when an event carries a header
 * (`data.h === 1`); subsequent batch events append to the currently-open file
 * for that app. Only the compact `event.data` payload is persisted (one JSON
 * line per event) — not the full envelope — since the header/batch shape is the
 * on-disk telemetry format the frontend recorder emits.
 *
 * Durability model: writes go through a synchronously-opened file descriptor
 * (fs.openSync + fs.writeSync), the same reliable approach the sibling
 * sessionFile transport uses. See the note below on why a fs.createWriteStream
 * hot path was not used.
 *
 * NOTE ON NON-BLOCKING STREAMS: the original design called for
 * fs.createWriteStream to keep the write path non-blocking. That cannot satisfy
 * this transport's contract, because flush() must make bytes visible to a
 * *synchronous* readFileSync immediately afterward (the test relies on this, and
 * so does an in-process consumer that rotates + re-reads a session). Node's
 * WriteStream buffers writes asynchronously and stream.end() does NOT drain that
 * buffer synchronously — verified empirically: content is still empty right after
 * end() returns. Retaining every line in memory to rewrite on flush would restore
 * synchronous durability but defeat the memory benefit streaming exists for. Since
 * the frontend already batches (one JSON line per event, not per note), a
 * synchronous writeSync per event imposes no meaningful blocking, so we use the
 * proven fd + writeSync path instead.
 *
 * Old files are pruned on initialization based on maxAgeDays.
 */

import fs from 'fs';
import path from 'path';

let instance = null;

/**
 * Initialize the session events file transport singleton
 * @param {Object} options
 * @param {string} options.baseDir - Base directory for events logs (e.g., media/logs)
 * @param {number} options.maxAgeDays - Delete files older than this (default: 30)
 */
export function initSessionEventsFileTransport({ baseDir, maxAgeDays = 30 }) {
  if (!baseDir) throw new Error('sessionEventsFile transport requires a baseDir');
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  pruneOldEventFiles(baseDir, maxAgeDays);

  // Map<app, { filePath, fd }>
  const sessions = new Map();

  const openSession = (app, session) => {
    const existing = sessions.get(app);
    if (existing?.fd != null) {
      try { fs.closeSync(existing.fd); } catch { /* ignore */ }
    }
    const appDir = path.join(baseDir, app);
    if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
    const safe = String(session).replace(/:/g, '-').replace(/\.\d+Z?$/, '');
    const filePath = path.join(appDir, `${safe}.events`);
    const fd = fs.openSync(filePath, 'a');
    sessions.set(app, { filePath, fd });
    return sessions.get(app);
  };

  instance = {
    write(event) {
      const app = event?.context?.app;
      if (!app || event?.context?.channel !== 'input') return;
      const data = event.data || {};
      if (data.h === 1) {
        const s = openSession(app, data.session);
        fs.writeSync(s.fd, JSON.stringify(data) + '\n');
        return;
      }
      let s = sessions.get(app);
      if (!s) s = openSession(app, new Date().toISOString());
      if (s?.fd != null) fs.writeSync(s.fd, JSON.stringify(data) + '\n');
    },

    flush() {
      for (const [, s] of sessions) {
        if (s.fd != null) {
          try { fs.closeSync(s.fd); } catch { /* ignore */ }
          s.fd = null;
        }
      }
      sessions.clear();
    },

    getStatus() {
      const out = {};
      for (const [app, s] of sessions) out[app] = { filePath: s.filePath, writable: s.fd != null };
      return { name: 'session-events-file', baseDir, sessions: out };
    },
  };

  return instance;
}

export function getSessionEventsFileTransport() { return instance; }

export function resetSessionEventsFileTransport() { if (instance) instance.flush(); instance = null; }

function pruneOldEventFiles(baseDir, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  let apps;
  try { apps = fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return; }
  for (const app of apps) {
    const dir = path.join(baseDir, app);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.events')) continue;
      try { if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  }
}

export default getSessionEventsFileTransport;
