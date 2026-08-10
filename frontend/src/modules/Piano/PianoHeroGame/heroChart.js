import { buildTempoMap } from '../../MusicNotation/scoreTimeline.js';
import { buildPerformanceTargets } from '../performance/performanceTargets.js';
import {
  advancePerformanceRun,
  applyPerformancePress,
  createPerformanceRun,
} from '../performance/performanceJudge.js';

export const HERO_DEFAULTS = {
  leadInMs: 3000,
  fallDurationMs: 3000,
  perfectWindowMs: 90,
  goodWindowMs: 220,
  missWindowMs: 420,
};

/**
 * Convert the renderer-independent MusicXML score model into Piano Hero targets.
 * Every simultaneous onset becomes one target group, so chords are judged as a
 * unit while still drawing one falling bar per pitch.
 */
export function buildHeroChart(score, options = {}) {
  const cfg = { ...HERO_DEFAULTS, ...options };
  if (!Number.isFinite(cfg.leadInMs)) cfg.leadInMs = HERO_DEFAULTS.leadInMs;
  if (!Number.isFinite(cfg.fallDurationMs)) cfg.fallDurationMs = HERO_DEFAULTS.fallDurationMs;
  const tempoMap = buildTempoMap(score?.tempoEntries || [], score?.tempo || 90);
  const targets = buildPerformanceTargets(
    (score?.parts || []).flatMap((part) => part?.notes || []),
    { tempoMap, leadInMs: cfg.leadInMs },
  );

  const pitches = targets.flatMap((target) => target.pitches);
  return {
    targets,
    tempo: score?.tempo || 90,
    timeSig: score?.timeSig || { beats: 4, beatType: 4 },
    leadInMs: cfg.leadInMs,
    fallDurationMs: cfg.fallDurationMs,
    startNote: pitches.length ? Math.min(...pitches) : 60,
    endNote: pitches.length ? Math.max(...pitches) : 72,
    durationMs: targets.length ? targets[targets.length - 1].targetTimeMs : 0,
  };
}

export function createHeroRun(chart) {
  const performance = createPerformanceRun(chart?.targets || []);
  return {
    ...performance,
    score: { points: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, misses: 0, wrong: 0 },
  };
}

export function clampHeroTempo(bpm) {
  return Math.max(40, Math.min(220, Math.round(Number(bpm) || 90)));
}

/** Rescale a built chart to a new constant BPM while preserving its lead-in. */
export function retimeHeroChart(chart, bpm) {
  if (!chart) return chart;
  const nextTempo = clampHeroTempo(bpm);
  const sourceTempo = clampHeroTempo(chart.tempo);
  if (nextTempo === sourceTempo) return chart;
  const leadInMs = Number(chart.leadInMs) || 0;
  const ratio = sourceTempo / nextTempo;
  return {
    ...chart,
    tempo: nextTempo,
    targets: chart.targets.map((target) => ({
      ...target,
      targetTimeMs: leadInMs + (target.targetTimeMs - leadInMs) * ratio,
      durationMs: target.durationMs * ratio,
    })),
    durationMs: leadInMs + (chart.durationMs - leadInMs) * ratio,
  };
}

/** Judge one note-on against the nearest still-available matching target. */
export function applyHeroPress(run, pitch, elapsedMs, options = {}) {
  const cfg = { ...HERO_DEFAULTS, ...options };
  if (!Number.isFinite(cfg.perfectWindowMs)) cfg.perfectWindowMs = HERO_DEFAULTS.perfectWindowMs;
  if (!Number.isFinite(cfg.goodWindowMs)) cfg.goodWindowMs = HERO_DEFAULTS.goodWindowMs;
  if (!Number.isFinite(cfg.missWindowMs)) cfg.missWindowMs = HERO_DEFAULTS.missWindowMs;
  const judged = applyPerformancePress(run, pitch, elapsedMs, cfg);
  const next = judged.run;
  if (judged.event.type === 'unmatched_note') {
    return { ...next, score: { ...run.score, combo: 0, wrong: run.score.wrong + 1 } };
  }
  if (judged.event.type === 'target_partial') return { ...next, score: run.score };

  const result = judged.event.result;
  const combo = run.score.combo + 1;
  const multiplier = Math.min(2, 1 + Math.floor(combo / 10) * 0.25);
  const base = result === 'perfect' ? 1000 : 600;
  return {
    ...next,
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
  const advanced = advancePerformanceRun(run, elapsedMs, cfg);
  const misses = advanced.events.length;
  if (!misses) return run;
  return {
    ...advanced.run,
    score: { ...run.score, combo: 0, misses: run.score.misses + misses },
  };
}

export function heroAccuracy(run) {
  const resolved = run?.score?.perfect + run?.score?.good + run?.score?.misses;
  if (!resolved) return 0;
  return Math.round(((run.score.perfect + run.score.good) / resolved) * 100);
}

export default { buildHeroChart, createHeroRun, applyHeroPress, advanceHeroRun, heroAccuracy, clampHeroTempo, retimeHeroChart };
