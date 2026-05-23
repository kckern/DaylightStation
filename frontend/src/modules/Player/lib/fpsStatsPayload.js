/**
 * Builder for `playback.fps_stats` log payloads.
 *
 * The 2026-05-23 audit (§4.1) found that `VideoPlayer.jsx` reported a
 * frozen `currentTime` value in `fps_stats` for the entire lifetime of
 * the outer `useEffect` — the interval callback closed over `seconds`
 * (and friends) at effect-creation time and never picked up rerenders.
 * In the witnessed incident, every fps_stats event in a 5.5-minute
 * Bluey session reported `currentTime: 107` despite real playback
 * advancing to 441s, which actively misled the audit investigation.
 *
 * The component keeps a `latestDataRef` that is updated by a second
 * effect on every render. By delegating payload construction to this
 * pure function — called with a snapshot of `latestDataRef.current`
 * — the interval callback no longer captures stale values from its
 * outer closure.
 */
export function buildFpsStatsPayload(snapshot, { estimatedFps } = {}) {
  const {
    seconds,
    quality,
    droppedFramePct,
    currentMaxKbps,
    duration,
    media,
    isDash,
    shader
  } = snapshot || {};

  const safeRound = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

  return {
    title: media?.title,
    grandparentTitle: media?.grandparentTitle,
    parentTitle: media?.parentTitle,
    mediaKey: media?.assetId || media?.key || media?.plex,
    currentTime: safeRound(seconds),
    duration: safeRound(duration),
    droppedFrames: quality?.droppedVideoFrames ?? null,
    totalFrames: quality?.totalVideoFrames ?? null,
    droppedPct: quality?.droppedPct?.toFixed?.(2) ?? null,
    avgDroppedPct: droppedFramePct ? (droppedFramePct * 100).toFixed(2) : null,
    bitrateCapKbps: currentMaxKbps ?? null,
    estimatedFps: estimatedFps ?? null,
    playbackRate: media?.playbackRate || 1,
    isDash: Boolean(isDash),
    shader: shader ?? null
  };
}
