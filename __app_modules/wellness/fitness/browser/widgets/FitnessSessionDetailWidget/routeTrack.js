// Where on the route the rider was at a moment of the session.
//
// `strava.map.track` (buildRouteTrack, server) holds Strava's latlng stream with
// its time offsets, downsampled to ~5 s. t[i] is seconds from the session start
// (a Strava-built session starts at the activity start), the same elapsed clock
// as the pane's shared axis — so the time cursor maps straight onto the route.

/** [lat, lng] at `elapsedMs`, linearly interpolated; clamped to the track's ends. */
export function positionAtElapsedMs(track, elapsedMs) {
  const t = track?.t;
  const pts = track?.points;
  if (!Array.isArray(t) || !Array.isArray(pts) || t.length < 2 || t.length !== pts.length || !Number.isFinite(elapsedMs)) return null;
  const s = elapsedMs / 1000;
  if (s <= t[0]) return pts[0];
  if (s >= t[t.length - 1]) return pts[pts.length - 1];
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= s) lo = mid; else hi = mid;
  }
  const f = (s - t[lo]) / (t[hi] - t[lo] || 1);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}
