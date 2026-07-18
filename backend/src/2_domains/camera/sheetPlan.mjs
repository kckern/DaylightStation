/**
 * Contact-sheet planning — decide what spans of a day get a sheet.
 *
 * The rule, in order of preference:
 *
 *   1. Every detected event gets its own sheet, so the frame interval adapts to
 *      the event's length. This matters: a fixed hourly sheet samples one frame
 *      per 100s, so a ~30s doorbell ring has only a ~30% chance of appearing at
 *      all. Two out of three visitors would be invisible.
 *   2. An event longer than an hour (kids playing in the yard) is split into
 *      hour-sized chunks, so one long session cannot smear 36 frames across
 *      three hours.
 *   3. Clock hours containing NO event get a plain hourly sheet, so the day is
 *      still covered end to end and "nothing happened 02:00-05:00" is legible
 *      at a glance.
 *
 * Pure functions over time ranges — no ffmpeg, no filesystem.
 *
 * @module 2_domains/camera/sheetPlan
 */

const HOUR_MS = 3600_000;

/**
 * @param {Array<{start: Date, end: Date, labels?: string[]}>} sessions
 * @param {string} day - YYYY-MM-DD
 * @param {{ maxSpanMs?: number }} [options]
 * @returns {Array<{kind:'event'|'hour', start:Date, end:Date, labels:string[], part?:number, parts?:number}>}
 */
export function planContactSheets(sessions, day, { maxSpanMs = HOUR_MS } = {}) {
  const dayStart = new Date(`${day}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * HOUR_MS);

  const events = [];
  for (const session of sessions ?? []) {
    // Clamp to the day: a session may run past midnight, and a sheet for
    // tomorrow's frames does not belong in today's folder.
    const start = new Date(Math.max(session.start.getTime(), dayStart.getTime()));
    const end = new Date(Math.min(session.end.getTime(), dayEnd.getTime()));
    if (end <= start) continue;
    events.push(...splitSpan(start, end, maxSpanMs, session.labels ?? []));
  }

  const covered = new Set();
  for (const e of events) {
    for (const h of hoursTouched(e.start, e.end, dayStart)) covered.add(h);
  }

  const hourly = [];
  for (let h = 0; h < 24; h++) {
    if (covered.has(h)) continue;
    const start = new Date(dayStart.getTime() + h * HOUR_MS);
    hourly.push({ kind: 'hour', start, end: new Date(start.getTime() + HOUR_MS), labels: [] });
  }

  return [...events, ...hourly].sort((a, b) => a.start - b.start);
}

/**
 * Split a span into at most `maxSpanMs` chunks.
 *
 * Chunks are equal-length rather than "full hours plus a remainder" so a
 * 70-minute session yields two 35-minute sheets instead of one dense hour and
 * one nearly-empty 10-minute sheet.
 */
function splitSpan(start, end, maxSpanMs, labels) {
  const total = end - start;
  if (total <= maxSpanMs) {
    return [{ kind: 'event', start, end, labels }];
  }
  const parts = Math.ceil(total / maxSpanMs);
  const size = total / parts;
  return Array.from({ length: parts }, (_, i) => ({
    kind: 'event',
    start: new Date(start.getTime() + i * size),
    end: new Date(start.getTime() + (i + 1) * size),
    labels,
    part: i + 1,
    parts,
  }));
}

/** Clock-hour indices a span overlaps, relative to the day's start. */
function hoursTouched(start, end, dayStart) {
  const first = Math.floor((start - dayStart) / HOUR_MS);
  // An event ending exactly on the hour boundary has not entered the next hour.
  const last = Math.ceil((end - dayStart) / HOUR_MS) - 1;
  const out = [];
  for (let h = Math.max(0, first); h <= Math.min(23, last); h++) out.push(h);
  return out;
}

/**
 * Frames-per-second needed to land `frameCount` frames across a span.
 *
 * Capped at the source rate: asking ffmpeg for more frames than the source has
 * duplicates them, producing a grid of near-identical tiles that looks like
 * detail but is not.
 */
export function sampleRateFor(spanMs, frameCount, sourceFps = 10) {
  const seconds = Math.max(1, spanMs / 1000);
  return Math.min(frameCount / seconds, sourceFps);
}

/**
 * Local-time components of a Date, zero-padded.
 * Always LOCAL: these files are read by humans thinking in wall-clock time.
 */
function parts(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return {
    Y: d.getFullYear(),
    M: p(d.getMonth() + 1),
    D: p(d.getDate()),
    h: p(d.getHours()),
    m: p(d.getMinutes()),
    s: p(d.getSeconds()),
  };
}

/**
 * Stable, sortable filename carrying a full LOCAL timestamp.
 *
 * The date is included even though the file sits in a per-day folder: sheets
 * get copied out, dropped into chats, and attached to messages, and a bare
 * "1801-person.jpg" is meaningless once separated from its directory.
 */
export function sheetName(entry) {
  const { Y, M, D, h, m, s } = parts(entry.start);
  const stamp = `${Y}-${M}-${D}_${h}${m}${s}`;
  if (entry.kind === 'hour') return `${stamp}-hour`;
  const label = (entry.labels[0] ?? 'motion').replace(/[^a-z0-9]/gi, '');
  const suffix = entry.parts ? `-p${entry.part}of${entry.parts}` : '';
  return `${stamp}-${label}${suffix}`;
}

/** EXIF-format local timestamp: "YYYY:MM:DD HH:MM:SS". */
export function exifTimestamp(date) {
  const { Y, M, D, h, m, s } = parts(date);
  return `${Y}:${M}:${D} ${h}:${m}:${s}`;
}

/**
 * Epoch shifted so ffmpeg's `gmtime` renders LOCAL wall-clock time.
 *
 * Deliberately not using ffmpeg's `localtime`, which reads the TZ environment
 * variable of whatever process happens to run it. Host and container agree
 * today, but a sheet whose burned-in times are silently 7 hours off is both
 * easy to cause and hard to notice. The offset is taken at the span's own
 * instant, so DST boundaries are handled.
 */
export function localEpochSeconds(date) {
  return Math.floor(date.getTime() / 1000) - date.getTimezoneOffset() * 60;
}
