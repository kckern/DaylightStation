/**
 * reviewParams — URL-driven start seek, shared by Player + VideoPlayer.
 *
 * `?goto=<seconds>` starts playback at an absolute time on load — for QA/Playwright
 * (or a human) to jump straight to a point of interest. When active, Player suppresses
 * the saved Plex resume (viewOffset in meta.seconds) so the review target is
 * authoritative and the resilience layer can't reassert resume. Parsed once at load.
 *
 * `?start=<seconds>` is an alias with the same meaning — the name people reach for
 * (`?play=plex:123&start=0` = "from the top, ignore where it was left"). Before it
 * was recognised, `start=0` was silently ignored and the saved resume won. When both
 * are present `goto` wins.
 *
 * Cue-by-id review is resolved to a concrete `?goto` time by the CLI (it fetches the
 * content-filter EDL, applies the sync offset + lead, then launches with ?goto=...),
 * keeping one reliable in-player seek primitive.
 */

/** Names that mean "start here, ignore saved resume", in precedence order. */
export const START_PARAM_KEYS = Object.freeze(['goto', 'start']);

/**
 * The start time (seconds) a search string asks for, or null.
 * Accepts a non-negative number under `goto` or `start` (first valid one wins).
 */
export function parseStartParam(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  for (const key of START_PARAM_KEYS) {
    const raw = params.get(key);
    if (raw == null) continue;
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

export const REVIEW_GOTO = typeof window !== 'undefined'
  ? parseStartParam(window.location.search) : null;

/** True when a start-seek param is present — resume should be suppressed. */
export const REVIEW_ACTIVE = REVIEW_GOTO != null;
