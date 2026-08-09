import { buildTempoMap, msAtQuarter } from '../../MusicNotation/scoreTimeline.js';

export const HERO_DEFAULTS = {
  leadInMs: 3000,
  fallDurationMs: 3000,
  perfectWindowMs: 90,
  goodWindowMs: 220,
  missWindowMs: 420,
};

const onsetKey = (quarter) => Number(quarter || 0).toFixed(6);

/**
 * Convert the renderer-independent MusicXML score model into Piano Hero targets.
 * Every simultaneous onset becomes one target group, so chords are judged as a
 * unit while still drawing one falling bar per pitch.
 */
export function buildHeroChart(score, options = {}) {
  const cfg = { ...HERO_DEFAULTS, ...options };
  if (!Number.isFinite(cfg.leadInMs)) cfg.leadInMs = HERO_DEFAULTS.leadInMs;
  if (!Number.isFinite(cfg.fallDurationMs)) cfg.fallDurationMs = HERO_DEFAULTS.fallDurationMs;
  const tempoMap = buildTempoMap([], score?.tempo || 90);
  const byOnset = new Map();

  for (const part of score?.parts || []) {
    for (const note of part?.notes || []) {
      if (note?.rest || !Number.isFinite(note?.midi)) continue;
      // A tie stop (including the middle of a longer tie) is sustain, not a new
      // attack. Asking the player to strike it again would contradict the score.
      if (note.tie === 'stop' || note.tie === 'both') continue;
      const key = onsetKey(note.onsetQuarter);
      const group = byOnset.get(key) || {
        onsetQuarter: Number(note.onsetQuarter) || 0,
        pitches: new Set(),
        durationQuarters: 0,
      };
      group.pitches.add(note.midi);
      group.durationQuarters = Math.max(group.durationQuarters, Number(note.durationQuarters) || 0);
      byOnset.set(key, group);
    }
  }

  const targets = [...byOnset.values()]
    .sort((a, b) => a.onsetQuarter - b.onsetQuarter)
    .map((group, index) => {
      const onsetMs = msAtQuarter(tempoMap, group.onsetQuarter);
      const offMs = msAtQuarter(tempoMap, group.onsetQuarter + group.durationQuarters);
      return {
        id: index + 1,
        pitches: [...group.pitches].sort((a, b) => a - b),
        targetTimeMs: cfg.leadInMs + onsetMs,
        durationMs: Math.max(90, offMs - onsetMs),
      };
    });

  const pitches = targets.flatMap((target) => target.pitches);
  return {
    targets,
    tempo: score?.tempo || 90,
    leadInMs: cfg.leadInMs,
    fallDurationMs: cfg.fallDurationMs,
    startNote: pitches.length ? Math.min(...pitches) : 60,
    endNote: pitches.length ? Math.max(...pitches) : 72,
    durationMs: targets.length ? targets[targets.length - 1].targetTimeMs : 0,
  };
}

export function createHeroRun(chart) {
  return {
    targets: (chart?.targets || []).map((target) => ({
      ...target,
      state: 'pending',
      hitPitches: [],
      drifts: [],
      resolvedAt: null,
      result: null,
    })),
    score: { points: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, misses: 0, wrong: 0 },
  };
}

/** Judge one note-on against the nearest still-available matching target. */
export function applyHeroPress(run, pitch, elapsedMs, options = {}) {
  const cfg = { ...HERO_DEFAULTS, ...options };
  if (!Number.isFinite(cfg.perfectWindowMs)) cfg.perfectWindowMs = HERO_DEFAULTS.perfectWindowMs;
  if (!Number.isFinite(cfg.goodWindowMs)) cfg.goodWindowMs = HERO_DEFAULTS.goodWindowMs;
  if (!Number.isFinite(cfg.missWindowMs)) cfg.missWindowMs = HERO_DEFAULTS.missWindowMs;
  let bestIndex = -1;
  let bestDrift = Infinity;
  for (let i = 0; i < run.targets.length; i++) {
    const target = run.targets[i];
    if (target.state !== 'pending' || target.hitPitches.includes(pitch) || !target.pitches.includes(pitch)) continue;
    const drift = elapsedMs - target.targetTimeMs;
    if (Math.abs(drift) <= cfg.goodWindowMs && Math.abs(drift) < Math.abs(bestDrift)) {
      bestIndex = i;
      bestDrift = drift;
    }
  }

  if (bestIndex < 0) {
    return { ...run, score: { ...run.score, combo: 0, wrong: run.score.wrong + 1 } };
  }

  const targets = [...run.targets];
  const target = targets[bestIndex];
  const hitPitches = [...target.hitPitches, pitch];
  const drifts = [...target.drifts, bestDrift];
  const complete = target.pitches.every((note) => hitPitches.includes(note));
  targets[bestIndex] = { ...target, hitPitches, drifts };
  if (!complete) return { ...run, targets };

  const worstDrift = Math.max(...drifts.map(Math.abs));
  const result = worstDrift <= cfg.perfectWindowMs ? 'perfect' : 'good';
  const combo = run.score.combo + 1;
  const multiplier = Math.min(2, 1 + Math.floor(combo / 10) * 0.25);
  const base = result === 'perfect' ? 1000 : 600;
  targets[bestIndex] = { ...targets[bestIndex], state: 'hit', result, resolvedAt: elapsedMs };
  return {
    targets,
    score: {
      ...run.score,
      points: run.score.points + Math.round(base * multiplier),
      combo,
      maxCombo: Math.max(run.score.maxCombo, combo),
      [result]: run.score[result] + 1,
    },
  };
}

/** Resolve targets whose timing window has passed. */
export function advanceHeroRun(run, elapsedMs, options = {}) {
  const cfg = { ...HERO_DEFAULTS, ...options };
  if (!Number.isFinite(cfg.missWindowMs)) cfg.missWindowMs = HERO_DEFAULTS.missWindowMs;
  let misses = 0;
  const targets = run.targets.map((target) => {
    if (target.state !== 'pending' || elapsedMs <= target.targetTimeMs + cfg.missWindowMs) return target;
    misses += 1;
    return { ...target, state: 'missed', result: 'miss', resolvedAt: elapsedMs };
  });
  if (!misses) return run;
  return {
    targets,
    score: { ...run.score, combo: 0, misses: run.score.misses + misses },
  };
}

export function heroAccuracy(run) {
  const resolved = run?.score?.perfect + run?.score?.good + run?.score?.misses;
  if (!resolved) return 0;
  return Math.round(((run.score.perfect + run.score.good) / resolved) * 100);
}

export default { buildHeroChart, createHeroRun, applyHeroPress, advanceHeroRun, heroAccuracy };
