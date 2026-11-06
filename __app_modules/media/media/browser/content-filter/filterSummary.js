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

/** Provisional until certified; a word cue that is not ms/frame precise could leak. */
export function isProvisional(cues = [], certification = null) {
  if (certification?.level) return false;
  return cues.some((c) => WORD.has(c.effect) && !PRECISE.has(c.precision));
}
