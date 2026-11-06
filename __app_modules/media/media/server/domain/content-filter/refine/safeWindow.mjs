/**
 * Safe windows for mutes refine could not pin to the word.
 *
 * VidAngel word tags drift from the spoken word. Measured on two films
 * (2026-11-06, 150 precisely timed words): the word starts 3.1 s before to
 * 2.7 s after the tag's in, and ends 3.8 s before to 2.8 s after its out (one
 * outlier at +10 s, a tag on the wrong line). A mute from tag.in - 3.5 s to
 * tag.out + 3.0 s covers every observed word but that outlier. It mutes more
 * dialogue, but no tagged word plays; pinning the word later narrows it.
 */
export const SAFE_BEFORE_SEC = 3.5;
export const SAFE_AFTER_SEC = 3.0;
const PRECISE = new Set(['ms', 'frame']);

/** Widen approximate mutes to safe windows (idempotent: keeps the original tag span). */
export function applySafeWindows(cues, { before = SAFE_BEFORE_SEC, after = SAFE_AFTER_SEC } = {}) {
  return cues.map((c) => {
    if (c.type !== 'mute' || PRECISE.has(c.precision)) return c;
    const tagIn = c.tagIn ?? c.in; const tagOut = c.tagOut ?? c.out;
    return { ...c, tagIn, tagOut, in: Math.max(0, round3(tagIn - before)), out: round3(tagOut + after), precision: 'safe-window' };
  });
}

const round3 = (x) => Math.round(x * 1000) / 1000;
