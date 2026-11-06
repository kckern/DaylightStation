/**
 * filterSummary — the bumper's one-line account of what the filter does to a
 * title, and the "provisional" rule the badge shows (spec §1, §2:
 * ops:docs/superpowers/specs/2026-11-06-content-filter-surround-design.md).
 * Pure: reads resolved effective cues only.
 */
import { PRECISE } from './contentFilter.js';

const WORD = new Set(['mute', 'bleep']);
const HIDE_BLUR = new Set(['blur', 'full-blur', 'pixelate']);
const HIDE_SOLID = new Set(['black', 'censor-bar']);
const SKIP = new Set(['skip', 'skip-card']);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function filterSummary(cues = []) {
  const words = cues.filter((c) => WORD.has(c.effect));
  const blurred = cues.filter((c) => HIDE_BLUR.has(c.effect)).length;
  const hidden = cues.filter((c) => HIDE_SOLID.has(c.effect)).length;
  const skips = cues.filter((c) => SKIP.has(c.effect));
  const credits = skips.filter((c) => String(c.category || '').startsWith('credits/')).length;
  const scenesSkipped = skips.length - credits;

  const parts = [];
  if (words.length) {
    const bleeps = words.filter((c) => c.effect === 'bleep').length;
    const verb = bleeps === words.length ? 'bleeped' : bleeps === 0 ? 'muted' : 'muted or bleeped';
    parts.push(`${plural(words.length, 'word')} ${verb}`);
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
export function isProvisional(cues = [], certification = null) {
  return !certification?.level;
}

/** Word cues (mute/bleep) not yet at ms/frame precision — the ones that could leak. */
export function unrefinedWordCount(cues = []) {
  return cues.filter((c) => WORD.has(c.effect) && !PRECISE.has(c.precision)).length;
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
