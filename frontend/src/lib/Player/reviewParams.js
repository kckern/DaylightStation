/**
 * reviewParams — URL-driven surgical review seek, shared by Player + VideoPlayer.
 *
 * `?goto=<seconds>` starts playback at an absolute time on load — for QA/Playwright
 * (or a human) to jump straight to a point of interest. When active, Player suppresses
 * the saved Plex resume (viewOffset in meta.seconds) so the review target is
 * authoritative and the resilience layer can't reassert resume. Parsed once at load.
 *
 * Cue-by-id review is resolved to a concrete `?goto` time by the CLI (it fetches the
 * content-filter EDL, applies the sync offset + lead, then launches with ?goto=...),
 * keeping one reliable in-player seek primitive.
 */

const params = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search) : null;

const goto = parseFloat(params?.get('goto'));
export const REVIEW_GOTO = Number.isFinite(goto) && goto >= 0 ? goto : null;

/** True when a review-seek param is present — resume should be suppressed. */
export const REVIEW_ACTIVE = REVIEW_GOTO != null;
