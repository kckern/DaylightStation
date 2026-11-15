/** Immutable original-content timeline, separate from observed renderer duration. */
const seconds = value => Number.isFinite(value) && value >= 0 ? value : null;

export function createContentTimeline({ catalogDurationSeconds, clipStartSeconds, clipEndSeconds,
  rendererStartSeconds, contentStartSeconds } = {}) {
  const expectedEndSeconds = seconds(catalogDurationSeconds) > 0 ? catalogDurationSeconds : null;
  return Object.freeze({ expectedEndSeconds, provenance: expectedEndSeconds === null ? 'unknown' : 'catalog',
    clipStartSeconds: seconds(clipStartSeconds), clipEndSeconds: seconds(clipEndSeconds),
    rendererStartSeconds: seconds(rendererStartSeconds), contentStartSeconds: seconds(contentStartSeconds) });
}

export function toContentSeconds(nativeSeconds, timeline) {
  if (seconds(nativeSeconds) === null || seconds(timeline?.rendererStartSeconds) === null
    || seconds(timeline?.contentStartSeconds) === null) return null;
  return nativeSeconds - timeline.rendererStartSeconds + timeline.contentStartSeconds;
}

export function validateMovieCompletion({ timeline, nativeSeconds }) {
  const end = seconds(timeline?.clipEndSeconds) ?? seconds(timeline?.expectedEndSeconds);
  if (end === null) return { complete: null, reason: 'completion-unverified' };
  const contentSeconds = toContentSeconds(nativeSeconds, timeline);
  if (contentSeconds === null) return { complete: null, reason: 'timeline-unverified' };
  return contentSeconds >= end - 3
    ? { complete: true, reason: 'content-end' }
    : { complete: false, reason: 'early-eof' };
}


/** Optional owner clock: legacy items without an authoritative end retain native time. */
export function readContentPosition(nativeSeconds, timeline) {
  const mapped = toContentSeconds(nativeSeconds, timeline);
  if (mapped !== null) return mapped;
  if (seconds(timeline?.expectedEndSeconds) !== null || seconds(timeline?.clipEndSeconds) !== null) return null;
  return seconds(nativeSeconds);
}
