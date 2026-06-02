import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// media/logs/fitness/*.jsonl — newest file, filtered to cycle_game.* events.
// The fitness app configures the logger with { app: 'fitness', sessionLog: true },
// so the cycle-game child logger's events land in the per-session JSONL file.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

export function readCycleGameEvents({ baseDir } = {}) {
  const dir = baseDir || process.env.DAYLIGHT_MEDIA_LOGS_FITNESS || path.join(ROOT, 'media/logs/fitness');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (files.length === 0) return [];
  const lines = fs.readFileSync(path.join(dir, files[0].f), 'utf8').split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (String(e.event || '').startsWith('cycle_game.')) events.push(e);
    } catch { /* skip malformed line */ }
  }
  return events;
}

export function hasEvent(events, name) {
  return events.some((e) => e.event === name);
}

export function lastEvent(events, name) {
  return [...events].reverse().find((e) => e.event === name) || null;
}
