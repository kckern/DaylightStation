/** A queued toast older than this is dropped, except milestones. */
export const TOAST_MAX_AGE_MS = 6000;

/**
 * Variants that mark a moment the player must not miss: shown however late,
 * never replaced by a newer toast of the same variant, and held longer.
 */
export const TOAST_KEEP_VARIANTS = Object.freeze(['finished', 'photo-finish', 'overtime', 'nosensor', 'final-lap']);
const KEEP = new Set(TOAST_KEEP_VARIANTS);

/**
 * Queue a toast. A newer toast replaces a queued one of the same variant,
 * except milestone variants, which all stay. Does not mutate `queue`.
 * @param {Array<{toast:{variant:string}, atMs:number}>} queue
 * @param {{variant:string}} toast
 * @param {number} nowMs
 * @returns {Array<{toast:object, atMs:number}>} a new queue
 */
export function pushToast(queue, toast, nowMs) {
  const base = Array.isArray(queue) ? queue : [];
  if (!toast) return [...base];
  const rest = KEEP.has(toast.variant) ? base : base.filter((e) => e?.toast?.variant !== toast.variant);
  return [...rest, { toast, atMs: nowMs }];
}

/**
 * Take the next fresh toast, dropping stale ones ahead of it.
 * @param {Array<{toast:{variant:string}, atMs:number}>} queue
 * @param {number} nowMs
 * @returns {{toast: object|null, queue: Array}} the toast to show and the remaining queue
 */
export function nextToast(queue, nowMs) {
  const live = (Array.isArray(queue) ? queue : []).filter((e) => e && e.toast
    && (KEEP.has(e.toast.variant) || !(nowMs - e.atMs > TOAST_MAX_AGE_MS)));
  if (!live.length) return { toast: null, queue: [] };
  return { toast: live[0].toast, queue: live.slice(1) };
}

/**
 * How long a toast stays on screen.
 * @param {string} variant
 * @returns {number} 4000 for milestone variants, else 3000
 */
export function toastDurationMs(variant) {
  return KEEP.has(variant) ? 4000 : 3000;
}
