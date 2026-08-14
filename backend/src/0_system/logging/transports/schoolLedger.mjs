/**
 * School Ledger Transport
 *
 * Writes School lifecycle events to a dated JSONL file under
 * `media/logs/school/YYYY-MM-DD.jsonl`, so a term's worth of issuance,
 * grading, enrollment and repair history survives a container restart.
 *
 * WHY THIS EXISTS: in Docker the only transports are console and Loggly, so
 * the School record lived in container stdout — and a redeploy is the normal
 * response to a School bug, which means the act of responding to a problem
 * destroyed the evidence for it. The sibling `sessionFile` transport already
 * solves this for Fitness and Piano; this is the same idea scoped to School.
 *
 * DELIBERATELY NOT A SESSION TRANSPORT: School work is not bounded by a
 * session-start event the way a workout is. A child's day is many short
 * sessions across several subjects, and the questions asked afterwards
 * ("what did this learner do in October", "when did this bar move") are
 * date-ranged, not session-ranged. One file per day answers those with `grep`;
 * `sessionId` is on the events themselves for narrowing to one piece of work.
 *
 * Failures here are swallowed by design. Logging must never take down the
 * thing it is observing — a full disk should cost you the ledger, not a
 * child's worksheet.
 */

import fs from 'fs';
import path from 'path';

const SCHOOL_EVENT = /^school\./;
const DEFAULT_MAX_AGE_DAYS = 400; // a full academic year plus a margin

/** `YYYY-MM-DD` in the host's local day, matching how the rest of School buckets days. */
function localDay(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date - offset).toISOString().slice(0, 10);
}

function pruneOldFiles(dir, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return; // nothing written yet
  }
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    } catch { /* a file we cannot stat or remove is not worth failing over */ }
  }
}

/**
 * @param {object} options
 * @param {string} options.baseDir - the media logs root (e.g. `<mediaDir>/logs`)
 * @param {number} [options.maxAgeDays] - prune dated files older than this
 * @returns {{name: string, send: (event: object) => void, flush: () => Promise<void>}}
 */
export function createSchoolLedgerTransport({ baseDir, maxAgeDays = DEFAULT_MAX_AGE_DAYS }) {
  if (!baseDir) throw new Error('School ledger transport requires a baseDir option');

  const dir = path.join(baseDir, 'school');

  // A ledger that cannot be created must cost the ledger, never the server.
  // Construction runs during boot, so an unguarded mkdir here turns an
  // unwritable media volume — a permissions slip, a full disk, a read-only
  // mount — into a FATAL that stops School working at all. Degrade to a no-op
  // transport and say so once, loudly enough to be found.
  let usable = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    pruneOldFiles(dir, maxAgeDays);
  } catch (err) {
    usable = false;
    process.stderr.write(
      `[WARN] school-ledger disabled: cannot use ${dir} (${err?.code ?? err?.message}). `
      + 'School events will still reach console and Loggly, but nothing will survive a restart.\n',
    );
  }

  // One descriptor held open per day, rolled when the date changes, so a busy
  // school day is not an open/close per event.
  let openDay = null;
  let fd = null;

  const fdForToday = () => {
    const day = localDay();
    if (day === openDay && fd != null) return fd;
    if (fd != null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      fd = null;
    }
    try {
      fd = fs.openSync(path.join(dir, `${day}.jsonl`), 'a');
      openDay = day;
    } catch {
      fd = null;
      openDay = null;
    }
    return fd;
  };

  return {
    name: 'school-ledger',

    send(event) {
      if (!usable) return;
      // Scoped by EVENT NAME, not by logger module: the events that matter
      // are emitted from application use cases, adapters and composition
      // alike, and they are uniformly `school.<area>.<event>` while their
      // `module` context varies (school, school-lifecycle, school-planning…).
      if (typeof event?.event !== 'string' || !SCHOOL_EVENT.test(event.event)) return;
      const handle = fdForToday();
      if (handle == null) return;
      try {
        fs.writeSync(handle, `${JSON.stringify(event)}\n`);
      } catch { /* see the file header: never take down the observed system */ }
    },

    async flush() {
      if (fd != null) {
        try { fs.fsyncSync(fd); } catch { /* ignore */ }
      }
    },
  };
}

export default createSchoolLedgerTransport;
