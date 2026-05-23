/**
 * `playback.seek-trace` helpers.
 *
 * The 2026-05-23 audit identified a programmatic seek to exact `duration`
 * (intent === duration === 441.759999) as the trigger for the screens-player
 * stuck-at-duration failure mode. The seek was tagged `source: "programmatic"`,
 * which is the fallback when no caller set `mediaEl.__seekSource`. None of
 * the known seek-emitting paths (start-time, BufferResilienceManager,
 * position watchdog, recovery strategies) emitted their preceding telemetry
 * in the audit window, so the actual trigger could not be pinned down from
 * existing logs.
 *
 * Capture `Error().stack` whenever the `seeking` event fires with an intent
 * within `thresholdSeconds` of duration. Sampled at the call site.
 *
 * See: docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md §2.1
 */
export function shouldTraceSeekAtDuration({ currentTime, duration, thresholdSeconds = 0.5 }) {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (!Number.isFinite(currentTime)) return false;
  return currentTime >= (duration - thresholdSeconds);
}

export function captureSeekStack() {
  // Slice to a budget so the log payload stays bounded.
  return (new Error('seek-at-duration-trace')).stack?.slice(0, 1500) || '';
}

export function buildSeekTracePayload({ assetId, mediaEl, stack }) {
  return {
    mediaKey: assetId,
    intent: mediaEl?.currentTime,
    duration: mediaEl?.duration,
    paused: mediaEl?.paused,
    seekSource: mediaEl?.__seekSource || 'programmatic',
    stack
  };
}
