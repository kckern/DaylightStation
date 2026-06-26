// watchLog.js
/** Build the POST api/v1/play/log payload (mirrors the fitness convention). */
export function buildWatchLogPayload({ contentId, title, seconds, duration, reason, userId, engaged }) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const percent = d ? Math.round((s / d) * 100) : 0;
  const naturalEnd = d > 0 && s >= d * 0.98;
  return {
    title: title || '',
    type: 'plex',
    assetId: contentId,
    seconds: Math.round(s),
    percent,
    status: naturalEnd ? 'completed' : (s > 0 ? 'in_progress' : 'none'),
    naturalEnd,
    duration: Math.round(d),
    reason: reason || 'progress',
    ...(userId ? { userId } : {}),
    ...(engaged !== undefined ? { engaged } : {}),
  };
}
