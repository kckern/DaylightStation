/**
 * scoreSettings — per-score, device-local practice settings (mode, tempo,
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
    // `focus` was persisted through v1 and is deliberately RETIRED: an indefinite
    // loop means the piece silently opens mid-score and never plays from the top,
    // which the field logs show confusing users across six sessions (audit M1).
    // `myStaves` (Listen's old "my part" claim set) is retired with the play-along
    // machinery itself (wave-3 A) — Listen now performs activeParts like every
    // other mode, so a legacy record has nothing left to restore. Stripping on
    // read also cleans up values written by older builds.
    const { v, focus, myStaves, ...rest } = obj;
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
