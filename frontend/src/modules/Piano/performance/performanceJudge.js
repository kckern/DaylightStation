export const PERFORMANCE_DEFAULTS = {
  perfectWindowMs: 90,
  goodWindowMs: 220,
  missWindowMs: 420,
};

const policyOf = (options = {}) => ({ ...PERFORMANCE_DEFAULTS, ...options });

export function createPerformanceRun(targets = []) {
  return {
    targets: targets.map((target) => ({
      ...target,
      state: 'pending',
      hitPitches: [],
      drifts: [],
      resolvedAt: null,
      result: null,
    })),
    unmatched: [],
  };
}

/** Match one note-on to the nearest pending target that expects that pitch. */
export function applyPerformancePress(run, pitch, atMs, options = {}, context = {}) {
  const policy = policyOf(options);
  const matchWindowMs = Number.isFinite(policy.matchWindowMs) ? policy.matchWindowMs : policy.goodWindowMs;
  let bestIndex = -1;
  let bestDrift = Infinity;

  for (let i = 0; i < run.targets.length; i++) {
    const target = run.targets[i];
    if (target.state !== 'pending' || target.hitPitches.includes(pitch) || !target.pitches.includes(pitch)) continue;
    const drift = atMs - target.targetTimeMs;
    if (Math.abs(drift) <= matchWindowMs && Math.abs(drift) < Math.abs(bestDrift)) {
      bestIndex = i;
      bestDrift = drift;
    }
  }

  if (bestIndex < 0) {
    const event = { type: 'unmatched_note', pitch, atMs, measureIndex: context.measureIndex ?? null };
    return { run: { ...run, unmatched: [...(run.unmatched || []), event] }, event };
  }

  const targets = [...run.targets];
  const target = targets[bestIndex];
  const hitPitches = [...target.hitPitches, pitch];
  const drifts = [...target.drifts, bestDrift];
  const complete = target.pitches.every((note) => hitPitches.includes(note));
  targets[bestIndex] = { ...target, hitPitches, drifts };

  if (!complete) {
    const event = { type: 'target_partial', targetId: target.id, pitch, driftMs: bestDrift };
    return { run: { ...run, targets }, event };
  }

  const worstDrift = Math.max(...drifts.map(Math.abs));
  const result = worstDrift <= policy.perfectWindowMs ? 'perfect' : 'good';
  targets[bestIndex] = { ...targets[bestIndex], state: 'hit', result, resolvedAt: atMs };
  const event = { type: 'target_hit', targetId: target.id, result, driftMs: bestDrift, worstDriftMs: worstDrift };
  return { run: { ...run, targets }, event };
}

/** Resolve every target whose late window has elapsed. */
export function advancePerformanceRun(run, atMs, options = {}) {
  const policy = policyOf(options);
  const events = [];
  const targets = run.targets.map((target) => {
    if (target.state !== 'pending' || atMs <= target.targetTimeMs + policy.missWindowMs) return target;
    events.push({ type: 'target_missed', targetId: target.id, atMs });
    return { ...target, state: 'missed', result: 'miss', resolvedAt: atMs };
  });
  return events.length ? { run: { ...run, targets }, events } : { run, events };
}

/** Close a measure at its boundary, including targets whose late window overlaps it. */
export function closePerformanceMeasure(run, measureIndex, atMs) {
  const events = [];
  const targets = run.targets.map((target) => {
    if (target.measureIndex !== measureIndex || target.state !== 'pending') return target;
    events.push({ type: 'target_missed', targetId: target.id, atMs });
    return { ...target, state: 'missed', result: 'miss', resolvedAt: atMs };
  });
  return events.length ? { run: { ...run, targets }, events } : { run, events };
}

export default {
  PERFORMANCE_DEFAULTS,
  createPerformanceRun,
  applyPerformancePress,
  advancePerformanceRun,
  closePerformanceMeasure,
};
