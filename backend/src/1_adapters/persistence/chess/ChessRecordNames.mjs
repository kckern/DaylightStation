import crypto from 'node:crypto';

export function buildGameRecordFilename(date = new Date()) {
  return `${date.toISOString().slice(0, 10)}-${crypto.randomUUID()}`;
}

export function buildChessArchiveFilename(record, userSlug, date = new Date()) {
  const slug = String(userSlug || 'guest').replace(/[^a-zA-Z0-9_-]/g, '-');
  const rawLevel = Number(record?.opponent?.level);
  const level = Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : 'unknown';
  const seconds = Math.floor(Math.max(0, Number(record?.duration_ms) || 0) / 1000);
  const duration = seconds >= 60
    ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
    : `${seconds}s`;
  const moves = Math.max(0, Math.floor(Number(record?.move_count) || 0));
  const result = String(record?.result || (record?.completed ? 'draw' : 'quit') || 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
  const outcome = String(record?.outcome || (record?.completed ? 'unknown' : 'quit'))
    .replace(/[^a-zA-Z0-9_-]/g, '-');
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `${slug}_level${level}_${duration}_${moves}ply_${result}_${outcome}_${stamp}-${crypto.randomUUID()}`;
}

export default { buildGameRecordFilename, buildChessArchiveFilename };
