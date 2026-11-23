/**
 * What a Blur actually plays on one shown part. One rule, two readers: the player (longHide.js
 * converts long whole-frame blurs) and the review page (the effect menu's Blur caption).
 */

/** Longest continuous whole-frame blur that stays a blur; past it the picture is hidden behind a card. */
export const DEFAULT_MAX_HIDE_SEC = 5;

/** The conversion threshold in seconds, or null when conversion is off (`maxSec` null or 0). */
export function maxHideSec(treatments) {
  const v = treatments?.['full-blur']?.maxSec;
  if (v === undefined) return DEFAULT_MAX_HIDE_SEC;
  const n = Number(v);
  return v === null || !Number.isFinite(n) || n <= 0 ? null : n;
}

/**
 * Tracked parts blur only the tracked thing; an untracked one blurs the whole picture, and past the
 * hide limit that becomes a hidden picture.
 * @returns {'blur'|'full-blur'|'blackout'}
 */
export function blurPlaysAs({ tracked, spanSec }, maxHide) {
  if (tracked) return 'blur';
  return maxHide != null && spanSec > maxHide ? 'blackout' : 'full-blur';
}
