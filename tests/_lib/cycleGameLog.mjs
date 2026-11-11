import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// media/logs/fitness/*.jsonl — cycle_game.* events across the RECENT files.
// The fitness app configures the logger with { app: 'fitness', sessionLog: true },
// so the cycle-game child logger's events land in the per-session JSONL file.
// NOTE: the session-file transport rotates a new file on each `session-log.start`
// (every app boot/config), so a single race's events can land just *before* the
// newest file. We therefore aggregate cycle_game.* events across the most recent
// files (by mtime), sorted by timestamp, rather than reading only the newest.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

export function readCycleGameEvents({ baseDir, maxFiles = 25 } = {}) {
  const dir = baseDir || process.env.DAYLIGHT_MEDIA_LOGS_FITNESS || path.join(ROOT, 'media/logs/fitness');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .slice(0, maxFiles);
  const events = [];
  for (const { f } of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (String(e.event || '').startsWith('cycle_game.')) events.push(e);
      } catch { /* skip malformed line */ }
    }
  }
  // Chronological order so lastEvent() reflects the most recent occurrence.
  // Timestamps are ISO strings (e.g. "2026-06-02T18:38:02.308Z"), so parse them
  // to epoch ms — a naive numeric subtraction of strings yields NaN (no ordering)
  // and lets lastEvent() pick a stale event from an older rotated file.
  const tsOf = (e) => {
    const t = e.ts ?? e.timestamp ?? e.time ?? 0;
    const n = typeof t === 'number' ? t : Date.parse(t);
    return Number.isFinite(n) ? n : 0;
  };
  events.sort((a, b) => tsOf(a) - tsOf(b));
  return events;
}

export function hasEvent(events, name) {
  return events.some((e) => e.event === name);
}

export function lastEvent(events, name) {
  return [...events].reverse().find((e) => e.event === name) || null;
}

/** Epoch ms of an event (0 when it carries no usable timestamp). */
export function eventTime(e) {
  const t = e.ts ?? e.timestamp ?? e.time ?? 0;
  const n = typeof t === 'number' ? t : Date.parse(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Poll the session log until an event named `name` (matching `predicate`, when
 * given) has been written, and return it. The log reaches disk a moment after
 * the page emits it, so a flow that reads right after an action must wait.
 * Pass `since` (epoch ms, taken at the start of the flow) so an event left in
 * the log by an earlier run is never mistaken for this run's.
 * Fails loudly with the event name when it never shows up.
 */
export async function waitForCycleEvent(name, predicate = () => true, { timeoutMs = 10000, pollMs = 250, baseDir, since = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = [...readCycleGameEvents({ baseDir })].reverse()
      .find((e) => e.event === name && eventTime(e) >= since && predicate(e));
    if (hit) return hit;
    if (Date.now() >= deadline) throw new Error(`log event ${name} not written within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** True when no event named `name` (matching `predicate`) is in the log now. */
export function lacksEvent(events, name, predicate = () => true) {
  return !events.some((e) => e.event === name && predicate(e));
}
