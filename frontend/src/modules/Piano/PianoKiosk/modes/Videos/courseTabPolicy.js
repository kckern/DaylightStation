// courseTabPolicy.js — per-TAB course policy (piano.yml videos.collections[]).
//
// A tab is one entry in `videos.collections`. Two policy flags may ride on it,
// alongside the membership keys (`plex`/`shows`/`exclude_shows`) that
// resolveCourseGroups already reads:
//
//   allow_speed: true       -> the playback-speed control may appear on this
//                              tab's lectures. Absent/false = never. Speed is
//                              meaningless on a lesson you're meant to play or
//                              sing along with in real time; it only makes
//                              sense for passive appreciation viewing.
//   engagement_gate: false  -> no play-a-note prompt on this tab. Voice/singing
//                              lessons produce no MIDI by design, so demanding
//                              a key press to prove attention is nonsense there.
//
// Both compose with the per-USER entry in `videos.user_policies` (coursePolicy.js).
// Speed is an AND: the user must be permitted AND the tab must permit. The gate
// is an OR-to-disable: either axis may switch it off.

const toList = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * The configured tabs, each carrying its membership keys and policy flags.
 * Mirrors resolveCourseGroups' normalization so the two cannot disagree about
 * which ids belong to a tab; adds the policy fields that grid rendering ignores.
 *
 * @param {object} videos - piano.yml `videos` block
 * @returns {Array<{label, collections, shows, excludeShows, allowSpeed, engagementGate}>}
 */
export function resolveTabPolicies(videos) {
  if (!Array.isArray(videos?.collections)) return [];
  return videos.collections
    .map((g) => ({
      label: g?.label || null,
      collections: toList(g?.plex ?? g?.collections),
      shows: toList(g?.shows),
      excludeShows: toList(g?.exclude_shows),
      allowSpeed: g?.allow_speed === true,
      engagementGate: g?.engagement_gate !== false,
    }))
    .filter((g) => g.collections.length || g.shows.length);
}

/**
 * Only tabs whose policy differs from the house default are worth resolving
 * membership for — everything else lands on the same answer anyway. Keeps the
 * membership lookup to the one or two collections that actually matter.
 */
export function tabsCarryingPolicy(tabs) {
  return (tabs || []).filter((t) => t.allowSpeed || t.engagementGate === false);
}

/**
 * Does `tab` own `courseId`?
 *
 * `shows` is a direct id list, so it answers without any network. `collections`
 * needs the collection's item ids, supplied by `itemsByCollection` (a map of
 * collection id -> array of item ids, or undefined while still unresolved).
 *
 * @returns {boolean|null} true/false, or null when a needed collection has not
 *   resolved yet — callers must treat null as "don't know", not "no".
 */
export function tabOwnsCourse(tab, courseId, itemsByCollection = {}) {
  if (!tab || !courseId) return false;
  const id = idOf(courseId);
  if (tab.excludeShows.some((s) => idOf(s) === id)) return false;
  if (tab.shows.some((s) => idOf(s) === id)) return true;
  let pending = false;
  for (const c of tab.collections) {
    const items = itemsByCollection[c];
    if (items == null) { pending = true; continue; }
    if (items.some((it) => idOf(it) === id)) return true;
  }
  return pending ? null : false;
}

/**
 * Fold the owning tab's policy into the user's.
 *
 * Unresolved membership (null from tabOwnsCourse) is treated as NOT a member —
 * which for speed means the control stays hidden. That is the safe direction:
 * a speed button that appears a beat late is a non-event, one that appears for
 * a child on a piano lesson is the bug we're fixing.
 *
 * @param {object} userPolicy - from resolveCoursePolicy (engagementGate, autoAdvance, allowSpeed)
 * @param {Array}  tabs       - from resolveTabPolicies
 * @param {string} courseId
 * @param {object} itemsByCollection
 */
export function resolveEffectivePolicy(userPolicy, tabs, courseId, itemsByCollection = {}) {
  const owning = (tabs || []).find((t) => tabOwnsCourse(t, courseId, itemsByCollection) === true) || null;
  return {
    ...userPolicy,
    tabLabel: owning?.label ?? null,
    // AND: both the person and the content type must permit speed.
    allowSpeed: userPolicy?.allowSpeed === true && owning?.allowSpeed === true,
    // Either axis may switch the gate off.
    engagementGate: userPolicy?.engagementGate !== false && owning?.engagementGate !== false,
  };
}

export default resolveEffectivePolicy;
