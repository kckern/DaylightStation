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
