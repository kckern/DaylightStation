import { selectPrimaryMedia, buildSelectionConfig } from '@/hooks/fitness/selectPrimaryMedia.js';

/**
 * Identity key for a media item / media event — what makes two of them "the same
 * video". Shared by the header's primary pick and the overlay's video markers so
 * both sides compare the same way.
 */
export function mediaIdentityKey(item) {
  const d = item?.data || item || {};
  const key = d.contentId ?? d.ratingKey ?? d.title;
  return key == null ? '' : String(key);
}

/**
 * Key of the session's primary video — the one the detail header already shows,
 * so the overlay can leave it out of the marker gutter.
 *
 * Mirrors the header's derivation (selectPrimaryMedia, then the stored flag, then
 * media[0]). `config` is optional: the header passes the household plex config,
 * the chart/timeline layers call it without one. Returns null when the session
 * carries no media summary, which leaves the overlay on its default behavior.
 */
export function resolvePrimaryMediaKey(sessionData, plexConfig) {
  const mediaList = Array.isArray(sessionData?.summary?.media) ? sessionData.summary.media : null;
  if (!mediaList || mediaList.length === 0) return null;
  const pm = selectPrimaryMedia(mediaList, buildSelectionConfig(plexConfig))
    || mediaList.find((m) => m.primary)
    || mediaList[0];
  return pm ? mediaIdentityKey(pm) || null : null;
}

/** Build a display image URL from a (possibly source-qualified) content id. */
export function mediaDisplayUrl(contentId) {
  if (!contentId) return null;
  const str = String(contentId);
  if (str.includes(':')) {
    const [source, id] = str.split(':', 2);
    return `/api/v1/display/${source}/${id}`;
  }
  return `/api/v1/display/plex/${str}`;
}

/**
 * Resolve the session start as epoch ms — the origin for rebasing timeline
 * event timestamps onto the tick axis. Mirrors the header's derivation:
 * group detail puts start at the root; normal sessions nest it under .session.
 */
export function resolveSessionStartMs(sessionData) {
  if (!sessionData) return null;
  const session = sessionData.session || {};
  if (session.start) return new Date(session.start).getTime();
  if (sessionData.start != null) return new Date(sessionData.start).getTime();
  if (Number.isFinite(sessionData.startTime)) return sessionData.startTime;
  return null;
}
