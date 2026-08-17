/**
 * Does a list row's action match what its content can actually do?
 *
 * A row pairs an `input` (a content id) with an `action`. Nothing forced the
 * two to agree, so `action: Display` could point at a source that only knows
 * how to play — which rendered as an empty <img> on the screen and an equally
 * empty preview in the admin, with no error anywhere.
 *
 * The backend already answers the question: `/api/v1/info/{source}/{id}`
 * returns a `capabilities` array. This module is the comparison.
 *
 * Design rule: BE QUIET. A warning that fires on healthy rows trains you to
 * ignore it, and then it protects nothing. Anything uncertain returns null.
 */

/**
 * Capabilities that satisfy each action — any one is enough.
 *
 * Verified against live adapter responses:
 *   plex episode      → playable, displayable
 *   singalong hymn    → playable, displayable
 *   files (video)     → playable, displayable
 *   files (image)     → playable                  ← cannot Display
 *   canvas (image)    → displayable
 *   art preset        → displayable
 *   menu / watchlist  → displayable, listable, queueable
 *   app               → openable
 *
 * `Read` is deliberately absent: no adapter emits `readable` (readalong
 * reports playable/displayable), so requiring it would flag every Read row.
 * Add it here only once an adapter actually reports the capability.
 */
export const ACTION_CAPABILITIES = {
  Play: ['playable'],
  // Only containers report `queueable`; a playable leaf is queueable in
  // practice, so accept either rather than flag every single-item Queue row.
  Queue: ['queueable', 'playable'],
  Display: ['displayable'],
  Open: ['openable'],
  List: ['listable'],
};

/**
 * @param {string} action - the row's action ('' / undefined means Play)
 * @param {string[]|null|undefined} capabilities - from the /info response
 * @returns {{action: string, accepts: string[]}|null} null when it matches,
 *   when the action has no rule, or when capabilities are unknown
 */
export function capabilityMismatch(action, capabilities) {
  const resolved = action || 'Play';
  const accepts = ACTION_CAPABILITIES[resolved];
  if (!accepts) return null;

  // Unknown is "cannot judge", never "broken" — a failed lookup or an adapter
  // that reports nothing must not paint a healthy row as an error.
  if (!Array.isArray(capabilities) || capabilities.length === 0) return null;

  if (accepts.some(cap => capabilities.includes(cap))) return null;
  return { action: resolved, accepts };
}

export default capabilityMismatch;
