/**
 * scoreSettings — per-score, device-local practice settings (mode, tempo, range,
 * hands) so a walk-up user finds a piece the way they left it. Stored in
 * localStorage under `daylight.piano.sm.<id>`; every access is wrapped so a private
 * window / disabled storage / corrupt value degrades to "no settings", never throws.
 *
 * Save is merge-on-write: a partial patch updates only the given fields.
 */
const KEY = (id) => `daylight.piano.sm.${id}`;
const VERSION = 1;

/** @returns {object} the stored settings for a score id, or {} on any problem. */
export function loadScoreSettings(id) {
  if (!id) return {};
  try {
    const raw = window.localStorage.getItem(KEY(id));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const { v, ...rest } = obj; // drop the envelope version from the returned view
    return rest;
  } catch {
    return {};
  }
}

/** Merge `patch` into the stored settings for a score id. No-op on any problem. */
export function saveScoreSettings(id, patch) {
  if (!id || !patch || typeof patch !== 'object') return;
  try {
    const current = loadScoreSettings(id);
    const next = { v: VERSION, ...current, ...patch };
    window.localStorage.setItem(KEY(id), JSON.stringify(next));
  } catch {
    /* storage unavailable / quota — settings are a convenience, not critical */
  }
}

export default { loadScoreSettings, saveScoreSettings };
