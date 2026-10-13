/**
 * Session replay authorization — classify recorded content that requires an
 * authorized fingerprint to watch from Fitness Home. Pure policy;
 * `useRecapUnlock` owns classification I/O and the replay unlock request.
 * Live playback starts through exercise governance, including Hot startup.
 *
 * Keep the existing fitness.yml key for compatibility — no config migration:
 *   playback_unlock:
 *     lock: kids_playback        # a key of `locks:` (who may unlock the replay)
 *     labels: [KidsFun]          # recorded content with any matching Plex label
 *     libraries: [TV Shows]      # recorded content from any matching library
 *     scope: show                # legacy field; replay grants cover one session
 *     prompt_timeout_seconds: 60 # how long the replay scan prompt waits
 *     session_recaps: true       # lock a past session's recap when any video it
 *                                # played matches (the recap shows it in PiP)
 *   locks: { kids_playback: [user_1, user_9] }
 * Replay authorization requires session_recaps, rules and an active named lock.
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

/** Legacy scope helper retained for compatibility; Home replay grants are per session. */
export function playbackUnlockScope(item, scope = 'show') {
  if (!item) return null;
  if (scope === 'item') return String(item.contentId || item.id);
  if (item.grandparentId) return `show:${item.grandparentId}`;
  if (item.showId) return `show:${item.showId}`;
  return String(item.contentId || item.id);
}

/**
 * Decide whether a past session's recap must be unlocked: required when ANY
 * video the session played matches the replay rules. Labels decide synchronously;
 * items whose labels don't decide it are looked up via `fetchInfo` when the library
 * could require authorization. A failed lookup requires a scan (fail closed).
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
