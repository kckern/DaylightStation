/**
 * lessonExpectation — the per-lesson "how much playing does this lesson ask
 * for" record, and the pure helpers that build it. No Node-only APIs.
 *
 * A record's `targetNpm` is the practice-like notes per minute that score a
 * sitting 10/10 (goodFaith.mjs). Sources:
 *   - measured: the engagement audit's engaged sittings (slowest one scores 10);
 *   - ai: one build-time rubric `score` over the caption transcript;
 *   - default: no captions and no measurement → watch-only (target 0).
 */

export const RUBRIC_INSTRUCTIONS = 'How much of this piano lesson does the student spend playing the piano themselves? `transcript` is the teacher\'s words with [mm:ss] times.';

export const RUBRIC_LEVELS = Object.freeze([
  'Watch only: the teacher explains, tells a story or shows notation; the student is not asked to play.',
  'A little: the student is asked to try a few notes or a short pattern once or twice.',
  'Regular: the student plays along at several points (your turn, pause the video and practise).',
  'Throughout: most of the lesson is the student playing along with the teacher.',
]);

export const LEVEL_TARGETS_DEFAULT = Object.freeze([0, 5, 13, 25]);
export const DEFAULT_TARGET_NPM = 0;
export const MEASURED_FLOOR_NPM = 6;
export const MEASURED_CAP_NPM = 40;
export const TRANSCRIPT_MAX_CHARS = 20000;

const SOURCES = new Set(['measured', 'ai', 'default']);

/** Measured lessons: the slowest engaged sitting scores 10; under 6/min means watch-only. */
export function measuredTarget({ minNpm } = {}) {
  const m = Number(minNpm);
  if (!Number.isFinite(m) || m < MEASURED_FLOOR_NPM) return 0;
  return Math.min(MEASURED_CAP_NPM, Math.round(m * 10) / 10);
}

/** Rubric score (0–3, possibly fractional) → { level, targetNpm }. */
export function levelTarget(score, table = LEVEL_TARGETS_DEFAULT) {
  const t = Array.isArray(table) && table.length === 4 ? table : LEVEL_TARGETS_DEFAULT;
  const s = Number(score);
  const level = Math.max(0, Math.min(3, Math.round(Number.isFinite(s) ? s : 0)));
  return { level, targetNpm: Number(t[level]) || 0 };
}

function srtTime(s) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s || '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** SRT text → [{ startSec, endSec, text }]. */
export function parseCaptionCues(srt) {
  if (typeof srt !== 'string' || !srt.trim()) return [];
  const blocks = srt.replace(/\r/g, '').split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const startSec = srtTime(a);
    if (startSec == null) continue;
    const text = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    cues.push({ startSec, endSec: srtTime(b), text });
  }
  return cues;
}

function mmss(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Cues → "[mm:ss] text" lines, capped at 20 000 chars (whole lines only). */
export function transcriptFor(cues, maxChars = TRANSCRIPT_MAX_CHARS) {
  let out = '';
  for (const c of cues || []) {
    const line = `[${mmss(c.startSec)}] ${c.text}`;
    const next = out ? `${out}\n${line}` : line;
    if (next.length > maxChars) break;
    out = next;
  }
  return out;
}

function bareId(id) {
  if (id == null) return null;
  const s = String(id).replace(/^plex:/, '');
  return s || null;
}

/** Validate/normalise a stored record; null when unusable. */
export function normalizeExpectation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const plexId = bareId(raw.plexId);
  const targetNpm = Number(raw.targetNpm);
  if (!plexId || !SOURCES.has(raw.source) || !Number.isFinite(targetNpm) || targetNpm < 0) return null;
  const level = [0, 1, 2, 3].includes(raw.level) ? raw.level : null;
  return {
    plexId,
    title: raw.title ?? null,
    season: raw.season ?? null,
    episode: raw.episode ?? null,
    durationSec: Number.isFinite(Number(raw.durationSec)) ? Number(raw.durationSec) : null,
    source: raw.source,
    targetNpm,
    level,
    levelScore: Number.isFinite(Number(raw.levelScore)) ? Number(raw.levelScore) : null,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    model: raw.model ?? null,
    measured: raw.measured && typeof raw.measured === 'object' ? raw.measured : null,
    captionHash: raw.captionHash ?? null,
    computedAt: raw.computedAt ?? null,
  };
}

function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation (ties averaged); null under 2 pairs. */
export function spearman(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
