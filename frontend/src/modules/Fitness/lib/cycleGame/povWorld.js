const lerp = (a, b, f) => a + (b - a) * (f || 0);

/** Lane offset across the road: single rider centred; N spread evenly over ±halfW*inset. */
export function laneX(idx, n, halfW, inset) {
  if (n <= 1) return 0;
  const span = halfW * inset;
  return -span + (idx * (2 * span)) / (n - 1);
}

/**
 * Pure race-data → world mapping for the POV road. World is metres; the road
 * recedes into −Z (the camera looks down −Z). Riders are placed at z = −distance;
 * the caller supplies an already DNF/non-moved-filtered rider list (but this
 * tolerates an empty list). Metre marks (1 m minor / 10 m major, majors labelled)
 * and lap/finish gates are emitted across the visible window. See the design spec:
 * docs/superpowers/specs/2026-06-06-pov-grid-threejs-camera-controls-design.md
 *
 * @returns {{ riders, leaderZ, lastZ, marks, gates }}
 */
export function povWorld({
  riders = [], frac = 0, laneCount = 0,
  lapLengthM = 0, finishM = null,
  aheadM = 25, gridMinorM = 1, gridMajorM = 10, fogFarM = 220,
  roadHalfW = 4, laneInset = 0.85,
}) {
  const n = laneCount || riders.length;
  const worldRiders = riders.map((r) => {
    const distM = Math.max(0, lerp(r.prev, r.cur, frac));
    return {
      id: r.id, idx: r.idx, isGhost: !!r.isGhost,
      x: laneX(r.idx, n, roadHalfW, laneInset), z: -distM, distM,
    };
  });

  if (!worldRiders.length) {
    return { riders: [], leaderZ: 0, lastZ: 0, marks: [], gates: [] };
  }

  const dists = worldRiders.map((r) => r.distM);
  const leaderM = Math.max(...dists);
  const lastM = Math.min(...dists);
  const leaderZ = -leaderM;
  const lastZ = -lastM;

  // Metre marks: from (leader − fogFarM, clamped ≥ 0) to (leader + aheadM), at minor spacing.
  const marks = [];
  const startM = Math.max(0, Math.ceil((leaderM - fogFarM) / gridMinorM) * gridMinorM);
  const endM = leaderM + aheadM;
  const majorEvery = Math.max(1, Math.round(gridMajorM / gridMinorM));
  for (let m = startM; m <= endM + 1e-6; m += gridMinorM) {
    const mr = Math.round(m / gridMinorM) * gridMinorM;
    const major = (mr / gridMinorM) % majorEvery === 0;
    marks.push({ z: -mr, m: mr, major, label: major ? `${mr}m` : null });
  }

  // Gates: lap multiples across the visible window (behind + ahead), never past finish; + finish.
  const gates = [];
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
  if (lap > 0) {
    const finishCap = Number.isFinite(finishM) && finishM > 0 ? finishM : Infinity;
    const nearM = Math.max(0, leaderM - fogFarM);
    const farM = Math.min(leaderM + aheadM, finishCap);
    const firstN = Math.max(1, Math.ceil(nearM / lap));
    for (let k = firstN; k * lap <= farM + 1e-6; k++) {
      const d = k * lap;
      if (Math.abs(d - finishCap) < 1e-6) continue; // the finish draws as its own gate
      gates.push({ z: -d, lap: k, isFinish: false, label: `LAP ${k}` });
    }
  }
  if (Number.isFinite(finishM) && finishM > 0) {
    gates.push({ z: -finishM, lap: null, isFinish: true, label: 'FINISH' });
  }

  return { riders: worldRiders, leaderZ, lastZ, marks, gates };
}

export default povWorld;
