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
  // Stable chronological order so lastEvent() reflects the most recent occurrence.
  events.sort((a, b) => (a.ts || a.timestamp || 0) - (b.ts || b.timestamp || 0));
  return events;
}

export function hasEvent(events, name) {
  return events.some((e) => e.event === name);
}

export function lastEvent(events, name) {
  return [...events].reverse().find((e) => e.event === name) || null;
}
