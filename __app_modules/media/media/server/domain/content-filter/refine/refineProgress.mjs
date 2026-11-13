/**
 * Refine's progress, read from the lines it already writes to stderr (refineCommand.mjs):
 * "Transcribing …", "Sync: …" and one "  [n/N] <cue> <kind> <status> <detail>" per cue measured.
 * The worker folds them into the run's step so Admin can show "measured n of N" and an ETA. Pure.
 */
const CUE = /^\s*\[(\d+)\/(\d+)\]\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/;
const RECENT = 8;

/** @returns {null | { phase: 'transcribe'|'sync'|'measure', done?, total?, cue?, kind?, status?, detail? }} */
export function parseRefineLine(line) {
  const s = String(line ?? '');
  if (/^Transcribing\b/.test(s)) return { phase: 'transcribe' };
  if (/^Sync:/.test(s)) return { phase: 'sync' };
  const m = CUE.exec(s);
  if (!m) return null;
  return { phase: 'measure', done: Number(m[1]), total: Number(m[2]), cue: m[3], kind: m[4], status: m[5], detail: m[6].trim() };
}

/** Fold one parsed line into the step's progress; `at` is the line's ISO time. */
export function foldProgress(prev, parsed, at) {
  if (!parsed) return prev;
  const p = prev || { phase: null, done: 0, total: null, firstAt: null, at: null, recent: [] };
  if (parsed.phase !== 'measure') return { ...p, phase: parsed.phase, at };
  const outcome = { cue: parsed.cue, kind: parsed.kind, status: parsed.status, detail: parsed.detail };
  return {
    ...p, phase: 'measure', done: parsed.done, total: parsed.total, firstAt: p.firstAt || at, at,
    recent: [outcome, ...p.recent].slice(0, RECENT),
  };
}
