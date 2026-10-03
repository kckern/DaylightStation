// frontend/src/modules/Player/lib/trackPolicy.js
//
// Subtitles and audio language (RQ-STEER-14) — the owner opt-in seam.
//
// Track selection is OPT-IN per Player, exactly like naturalEndPolicy.js: an
// owner (a screen's session host, the Media app's PlayerBridge) registers
// with `isOwner(playerInstanceId)`, and only the Player it claims ever reads a
// remembered choice, rewrites a stream URL or reports its tracks. Every other
// Player — the garage fitness display, the piano tablet, a school lesson —
// behaves exactly as before.
//
// A registration:
//   isOwner(instanceId)            → true for the Player this owner steers
//   getPreference(key)             → remembered choice for a show/item key, or null
//   setPreference(key, preference) → remember a choice (keyed by show, so it carries on)
//   onTracks(state, { instanceId }) → the current item's tracks changed

const registrations = [];

/**
 * Register a track owner. Returns an unregister that removes only this entry.
 */
export function registerTrackOwner(owner) {
  if (!owner || typeof owner.isOwner !== 'function') return () => {};
  const entry = { owner };
  registrations.push(entry);
  return () => {
    const index = registrations.indexOf(entry);
    if (index >= 0) registrations.splice(index, 1);
  };
}

/** The owner that claims this Player, or null (the Player then does nothing new). */
export function getTrackOwner(instanceId) {
  if (!instanceId) return null;
  for (let i = registrations.length - 1; i >= 0; i -= 1) {
    const { owner } = registrations[i];
    try {
      if (owner.isOwner(instanceId) === true) return owner;
    } catch {
      // A throwing owner check never claims a Player.
    }
  }
  return null;
}

/** Test helper. */
export function __resetTrackOwners() {
  registrations.splice(0, registrations.length);
}

// --- Remembered choices (per device, browser storage) -------------------------

const STORAGE_PREFIX = 'daylight.track-preferences.v1';
const MAX_ENTRIES = 200;

/**
 * A small per-device store of track choices keyed by show/item. Browser
 * storage only — a choice is a per-viewer convenience; losing it means the
 * next episode plays with the file's own default, never an error.
 */
export function createTrackPreferenceStore({ namespace = 'local', storage = null } = {}) {
  const key = `${STORAGE_PREFIX}:${namespace}`;
  const store = () => {
    if (storage) return storage;
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
  };
  let memory = null;
  const read = () => {
    if (memory) return memory;
    try {
      const raw = store()?.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      memory = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      memory = {};
    }
    return memory;
  };
  return {
    get(prefKey) {
      if (!prefKey) return null;
      return read()[prefKey]?.preference ?? null;
    },
    set(prefKey, preference) {
      if (!prefKey) return;
      const all = { ...read(), [prefKey]: { preference, at: Date.now() } };
      const keys = Object.keys(all);
      if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => (all[a].at ?? 0) - (all[b].at ?? 0))
          .slice(0, keys.length - MAX_ENTRIES)
          .forEach((k) => { delete all[k]; });
      }
      memory = all;
      try { store()?.setItem(key, JSON.stringify(all)); } catch { /* storage full or blocked: memory only */ }
    },
  };
}
