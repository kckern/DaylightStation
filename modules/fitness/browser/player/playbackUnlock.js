/**
 * Playback unlock — which queued items need an authorized fingerprint before
 * they may play. Pure policy; `usePlaybackUnlockGate` does the I/O.
 *
 * Everything is defined in fitness.yml — nothing here names a label, library
 * or lock:
 *   playback_unlock:
 *     lock: kids_playback        # a key of `locks:` (who may unlock)
 *     labels: [KidsFun]          # any matching Plex label gates the item
 *     libraries: [TV Shows]      # any item from these Plex libraries is gated
 *     scope: show                # show = one scan covers the show; item = every item
 *     prompt_timeout_seconds: 60 # how long the scan prompt waits before giving up
 *     session_recaps: true       # also lock a past session's recap video when any
 *                                # video it played matches (the recap shows it in PiP)
 *   locks: { kids_playback: [user_1, user_9] }
 * No `lock`, no rules, or an empty lock list ⇒ nothing is gated.
 */

const norm = (v) => String(v ?? '').trim().toLowerCase();
const toSet = (list) => new Set((Array.isArray(list) ? list : []).map(norm).filter(Boolean));

/** @returns {{ lock: string|null, labels: Set<string>, libraries: Set<string>, scope: 'show'|'item', promptTimeoutMs: number|null }} */
export function normalizePlaybackUnlockRules(cfg) {
  const lock = typeof cfg?.lock === 'string' && cfg.lock.trim() ? cfg.lock.trim() : null;
  return {
    lock,
    labels: toSet(cfg?.labels),
    libraries: toSet(cfg?.libraries),
    scope: norm(cfg?.scope) === 'item' ? 'item' : 'show',
    promptTimeoutMs: Number(cfg?.prompt_timeout_seconds) > 0 ? Number(cfg.prompt_timeout_seconds) * 1000 : null,
    sessionRecaps: cfg?.session_recaps === true,
  };
}

function matchedLabel(item, rules) {
  for (const label of item?.labels || []) {
    if (rules.labels.has(norm(label))) return norm(label);
  }
  return null;
}

/**
 * @param {{ labels?: string[], librarySectionTitle?: string }} item
 * @returns {{ required: boolean, reason: string|null }}
 */
export function classifyPlaybackUnlock(item, rules) {
  const label = matchedLabel(item, rules);
  if (label) return { required: true, reason: `label:${label}` };
  const library = norm(item?.librarySectionTitle);
  if (library && rules.libraries.has(library)) return { required: true, reason: `library:${library}` };
  return { required: false, reason: null };
}

/** Queue items carry labels but not their library — fetch it only when it could matter. */
export function needsLibraryLookup(item, rules) {
  if (!rules.libraries.size) return false;
  if (matchedLabel(item, rules)) return false;
  return !item?.librarySectionTitle;
}

/** scope 'show': one scan unlocks the whole show; 'item' (or a standalone item): only itself. */
export function playbackUnlockScope(item, scope = 'show') {
  if (!item) return null;
  if (scope === 'item') return String(item.contentId || item.id);
  if (item.grandparentId) return `show:${item.grandparentId}`;
  if (item.showId) return `show:${item.showId}`;
  return String(item.contentId || item.id);
}

/**
 * Decide whether a past session's recap must be unlocked: required when ANY
 * video the session played is gated. Labels decide synchronously; items whose
 * labels don't and that could be library-gated are looked up via `fetchInfo`.
 * A failed lookup counts as gated (fail closed).
 * @param {Array<{contentId?: string, labels?: string[]}>} mediaList - session summary.media
 * @returns {Promise<{ required: boolean, reason: string|null }>}
 */
export async function classifySessionRecap(mediaList, rules, fetchInfo) {
  const items = Array.isArray(mediaList) ? mediaList : [];
  const pending = [];
  for (const item of items) {
    const v = classifyPlaybackUnlock(item, rules);
    if (v.required) return v;
    if (needsLibraryLookup(item, rules)) pending.push(item);
  }
  for (const item of pending) {
    const cid = String(item.contentId || '');
    const plexId = cid.startsWith('plex:') ? cid.slice(5) : null;
    if (!plexId || typeof fetchInfo !== 'function') continue;
    try {
      const info = await fetchInfo(plexId);
      const v = classifyPlaybackUnlock({
        labels: [...(item.labels || []), ...(info?.labels || [])],
        librarySectionTitle: info?.librarySectionTitle,
      }, rules);
      if (v.required) return v;
    } catch {
      return { required: true, reason: 'lookup-failed' };
    }
  }
  return { required: false, reason: null };
}
