/**
 * filterSummary — the bumper's one-line account of what the filter does to a
 * title, and the "provisional" rule the badge shows (spec §1, §2:
 * ops:docs/superpowers/specs/2026-11-06-content-filter-surround-design.md).
 * Pure: reads resolved effective cues only.
 */
import { PRECISE, baseId } from './contentFilter.js';

const WORD = new Set(['mute', 'bleep']);
const HIDE_BLUR = new Set(['blur', 'full-blur', 'pixelate']);
const HIDE_SOLID = new Set(['black', 'blackout', 'censor-bar']);
const SKIP = new Set(['skip', 'skip-card']);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The ONE THING a cue piece belongs to. Resolution splits a cue into pieces — a
 * tracked regional blur into one piece per keyframe (`va123#0@4`), a word into
 * tone pieces and mute remainders (`…#m0`) — and a subject group (R6) or a scene
 * is one thing on screen whatever its members. Counting pieces said "271 scenes
 * blurred" for a title with ~58. Every count — this summary and the preview
 * timeline's legend (`kindCounts`) — is taken over this key.
 */
export function unitKey(c) {
  if (c?.scene != null) return `scene:${c.scene}`;
  if (c?.subject != null) return `subject:${c.subject}`;
  return `cue:${baseId(c?.id)}`;
}

/** Unique units among `cues` (first piece wins). */
export function uniqueUnits(cues) {
  const seen = new Map();
  for (const c of cues) {
    const k = unitKey(c);
    if (!seen.has(k)) seen.set(k, c);
  }
  return [...seen.values()];
}

/**
 * Words, counted once per word: a tone's mute remainders are the same word, and
 * the pieces of one base cue are one word (a merged tone carries `words`, so the
 * unit takes its largest count). Returns `[{ n, effect }]`, one per word cue.
 */
export function wordUnits(cues) {
  const byKey = new Map();
  for (const c of cues) {
    if (!WORD.has(c.effect) || c.toneRemainder) continue;
    const k = `cue:${baseId(c.id)}`;
    const n = c.words ?? 1;
    const prev = byKey.get(k);
    if (!prev || n > prev.n) byKey.set(k, { n, effect: c.effect });
  }
  return [...byKey.values()];
}

export function filterSummary(cues = []) {
  const words = wordUnits(cues);
  const wordCount = words.reduce((n, w) => n + w.n, 0);
  const blurred = uniqueUnits(cues.filter((c) => HIDE_BLUR.has(c.effect))).length;
  // A scene split across sync segments is one scene.
  const hidden = uniqueUnits(cues.filter((c) => HIDE_SOLID.has(c.effect) && c.firstPiece !== false)).length;
  const skips = uniqueUnits(cues.filter((c) => SKIP.has(c.effect)));
  const credits = skips.filter((c) => String(c.category || '').startsWith('credits/')).length;
  const scenesSkipped = skips.length - credits;

  const parts = [];
  if (words.length) {
    const bleeps = words.filter((c) => c.effect === 'bleep').length;
    const verb = bleeps === words.length ? 'bleeped' : bleeps === 0 ? 'muted' : 'muted or bleeped';
    parts.push(`${plural(wordCount, 'word')} ${verb}`);
  }
  if (blurred) parts.push(`${plural(blurred, 'scene')} blurred`);
  if (hidden) parts.push(`${plural(hidden, 'scene')} hidden`);
  if (scenesSkipped) parts.push(`${plural(scenesSkipped, 'scene')} skipped`);
  if (credits) parts.push('credits skipped');
  return parts.join(' · ');
}

/**
 * Provisional until certified (spec: "No block = provisional"). Certification is
 * written by refine (machine: no approximate word cue left) or by a parent sign-off.
 */
const CERTIFIED = new Set(['machine', 'parent']);
export function isProvisional(cues = [], certification = null) {
  // The server's certification block always names a level; 'none' is not certified.
  return !CERTIFIED.has(certification?.level);
}

/** Word cues (mute/bleep) not yet at ms/frame precision — the ones that could leak. */
export function unrefinedWordCount(cues = []) {
  return cues.filter((c) => WORD.has(c.effect) && !c.toneRemainder && !PRECISE.has(c.precision)).length;
}

/**
 * Where the bumper's "started from the top" window ends. An opening skip (credits
 * at 0–18 s) seeks the playhead before the bumper reads it on the first `playing`,
 * so a skip that starts inside the window extends it past that skip's end.
 */
export function bumperStartWindowSec(cues = [], baseSec = 5) {
  let end = baseSec;
  for (const c of cues) {
    if ((c.effect === 'skip' || c.effect === 'skip-card') && c.in <= end) end = Math.max(end, c.out + 1);
  }
  return end;
}
