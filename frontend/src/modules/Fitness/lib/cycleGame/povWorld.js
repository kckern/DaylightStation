import { formatDistance } from './formatDistance.js';
import { ordinal, gapToAboveText, finishedMetricText } from './standingsFormat.js';

const lerp = (a, b, f) => a + (b - a) * (f || 0);

/** Lane offset across the road: single rider centred; N spread evenly over ±halfW*inset. */
export function laneX(idx, n, halfW, inset) {
  if (n <= 1) return 0;
  const span = halfW * inset;
  return -span + (idx * (2 * span)) / (n - 1);
}

/**
 * Gap compression (audit C5): a rider more than ~100 m ahead of the camera
 * anchor would dolly past the max-zoom cap and fog out, so the person you're
 * chasing leaves the screen. We keep true metres inside the identity window
 * (≤ 100 m) and compress everything beyond it logarithmically so the leader
 * ALWAYS renders on-screen. Monotonic and identity for gap ≤ 100 m (so ordinary
 * close racing is untouched); grows without bound but very slowly (a 1 km gap
 * displays as ~226 m). Negative gaps (marks/riders behind the anchor) are
 * identity too. Pure — unit-tested.
 *
 * @param {number} gap  metres ahead of the anchor (may be negative)
 * @returns {number}    displayed metres ahead of the anchor
 */
export function displayGap(gap) {
  if (!(gap > 100)) return gap; // identity ≤ 100 m (and behind the anchor)
  return 100 + 40 * Math.log1p((gap - 100) / 40);
}

/** Displayed distance for a true distance `m`, anchored at the camera-follow point. */
export function displayDist(m, anchorM) {
  return anchorM + displayGap(m - anchorM);
}

/**
 * Per-rider fixed-screen-size badge text: rank ordinal + gap-to-next-above
 * ("2nd · −12 m"), mirroring the StandingsTower (T8) standings so the two
 * panels can never disagree. Rank prefers the container-forwarded live
 * `standings()` placement, falling back to live distance order. The group
 * leader / an out-of-contention rider shows their own metric instead of a
 * gap; a genuinely finished (non-DNF, non-overtime) rider shows the
 * win-condition-appropriate metric via the shared `finishedMetricText` (a
 * distance race finishes everyone at the same distance, so only finish TIME
 * differentiates finishers — T9 review). Pure — unit-tested.
 *
 * @returns {{ [id]: { rank, ordinal, gapText, text } }}
 */
export function povBadges({ riderIds = [], riders = {}, riderLive = {}, winCondition = 'distance' }) {
  const rows = riderIds.map((id) => {
    const rider = riders[id] || {};
    const live = riderLive[id] || {};
    return {
      id,
      distanceM: Math.max(0, rider.cumulativeDistanceM || 0),
      finishTimeS: Number.isFinite(rider.finishTimeS) ? rider.finishTimeS : null,
      placement: Number.isFinite(live.placement) ? live.placement : null,
      speedKmh: Number.isFinite(live.speedKmh) ? live.speedKmh : 0,
      dnf: !!live.dnf,
      overtime: !!live.overtime,
      finished: !!live.finished || Number.isFinite(rider.finishTimeS),
    };
  });
  const byPlacement = (a, b) => (a.placement ?? 999) - (b.placement ?? 999);
  const byDistanceDesc = (a, b) => b.distanceM - a.distanceM;
  const active = rows
    .filter((r) => !r.dnf && !r.overtime && !r.finished)
    .sort((a, b) => byPlacement(a, b) || byDistanceDesc(a, b));

  const out = {};
  let rank = 0;
  active.forEach((r, i) => {
    rank += 1;
    const useRank = r.placement ?? rank;
    const above = active[i - 1];
    const gapText = above
      ? gapToAboveText({ winCondition, gapM: above.distanceM - r.distanceM, abovePaceKmh: above.speedKmh })
      : formatDistance(r.distanceM);
    out[r.id] = { rank: useRank, ordinal: ordinal(useRank), gapText, text: `${ordinal(useRank)} · ${gapText}` };
  });
  rows.filter((r) => r.finished || r.overtime || r.dnf).forEach((r) => {
    const useRank = r.placement ?? null;
    const ord = useRank ? ordinal(useRank) : '';
    const gapText = r.dnf
      ? 'DNF'
      : r.overtime
        ? formatDistance(r.distanceM)
        : finishedMetricText({ winCondition, finishTimeS: r.finishTimeS, distanceM: r.distanceM });
    out[r.id] = { rank: useRank, ordinal: ord, gapText, text: ord ? `${ord} · ${gapText}` : gapText };
  });
  return out;
}

/**
 * Pure race-data → world mapping for the POV road. World is metres; the road
 * recedes into −Z (the camera looks down −Z). Riders are placed at
 * z = −displayDist(distance) — gap-compressed so a far leader stays on-screen
 * (audit C5). ALL riders passed in are placed (including not-yet-moved riders
 * parked at z = 0 for the start-line lineup); the `framingMoved` flag decides
 * whether the camera-framing anchor (leaderZ/lastZ) is computed from moved
 * riders only or the whole grid — the caller flips it on after a start grace so
 * the first frames frame the whole start line.
 *
 * Metre marks (1 m minor / 10 m major, majors labelled) and lap/finish gates are
 * emitted rider-anchored across [lastPlaceM − behindM, leaderM + aheadM] so the
 * TRAILING rider (whom the camera follows) always rides a labelled road with lap
 * arches — not the leader-anchored blank road the audit found.
 * See docs/superpowers/specs/2026-06-06-pov-grid-threejs-camera-controls-design.md
 *
 * @returns {{ riders, leaderZ, lastZ, leaderM, lastM, anchorM, marks, gates }}
 */
export function povWorld({
  riders = [], frac = 0, laneCount = 0,
  lapLengthM = 0, finishM = null,
  aheadM = 25, behindM = 30, gridMinorM = 1, gridMajorM = 10,
  roadHalfW = 4, laneInset = 0.85, framingMoved = true,
}) {
  const n = laneCount || riders.length;
  const rawRiders = riders.map((r) => {
    const distM = Math.max(0, lerp(r.prev, r.cur, frac));
    return { id: r.id, idx: r.idx, isGhost: !!r.isGhost, distM, x: laneX(r.idx, n, roadHalfW, laneInset) };
  });

  if (!rawRiders.length) {
    return { riders: [], leaderZ: 0, lastZ: 0, leaderM: 0, lastM: 0, anchorM: 0, marks: [], gates: [] };
  }

  // Framing anchor: moved riders only (a stalled 0 m rider can't crush the scale)
  // unless the caller wants the whole grid framed (start-line grace) or nobody
  // has moved yet.
  const movers = rawRiders.filter((r) => r.distM > 0);
  const framePool = (framingMoved && movers.length) ? movers : rawRiders;
  const frameDists = framePool.map((r) => r.distM);
  const leaderM = Math.max(...frameDists);
  const lastM = Math.min(...frameDists);
  const anchorM = lastM; // the camera follows the trailing framed rider

  const worldRiders = rawRiders.map((r) => ({
    id: r.id, idx: r.idx, isGhost: r.isGhost, x: r.x, distM: r.distM,
    z: -displayDist(r.distM, anchorM),
  }));
  const leaderZ = -displayDist(leaderM, anchorM);
  const lastZ = -displayDist(lastM, anchorM);

  // Metre marks: rider-anchored [lastM − behindM (clamped ≥0), leaderM + aheadM].
  const marks = [];
  const startM = Math.max(0, Math.ceil((lastM - behindM) / gridMinorM) * gridMinorM);
  const endM = leaderM + aheadM;
  const majorEvery = Math.max(1, Math.round(gridMajorM / gridMinorM));
  const MAX_MARKS = 4000; // safety bound for a very spread field
  let count = 0;
  for (let m = startM; m <= endM + 1e-6 && count < MAX_MARKS; m += gridMinorM, count++) {
    const mr = Math.round(m / gridMinorM) * gridMinorM;
    const major = (mr / gridMinorM) % majorEvery === 0;
    marks.push({ z: -displayDist(mr, anchorM), m: mr, major, label: major ? `${mr}m` : null });
  }

  // Gates: lap multiples across the same rider-anchored window, never past finish; + finish.
  const gates = [];
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
  if (lap > 0) {
    const finishCap = Number.isFinite(finishM) && finishM > 0 ? finishM : Infinity;
    const nearM = Math.max(0, lastM - behindM);
    const farM = Math.min(leaderM + aheadM, finishCap);
    const firstN = Math.max(1, Math.ceil(nearM / lap));
    for (let k = firstN; k * lap <= farM + 1e-6; k++) {
      const d = k * lap;
      if (Math.abs(d - finishCap) < 1e-6) continue; // the finish draws as its own gate
      gates.push({ z: -displayDist(d, anchorM), lap: k, isFinish: false, label: `LAP ${k}` });
    }
  }
  if (Number.isFinite(finishM) && finishM > 0) {
    gates.push({ z: -displayDist(finishM, anchorM), lap: null, isFinish: true, label: 'FINISH' });
  }

  return { riders: worldRiders, leaderZ, lastZ, leaderM, lastM, anchorM, marks, gates };
}

export default povWorld;
