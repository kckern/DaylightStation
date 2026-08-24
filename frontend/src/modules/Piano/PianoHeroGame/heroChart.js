import { buildTempoMap, msAtQuarter } from '../../MusicNotation/scoreTimeline.js';
import {
  advanceAssessment,
  compileScoreExpectation,
  createAssessmentAttempt,
  finalizeAssessmentAttempt,
  observeAssessment,
  startAssessmentAttempt,
} from '../performance/assessmentSession.js';

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
  const scoreNotes = (score?.parts || []).flatMap((part) => part?.notes || []);
  const expectation = compileScoreExpectation({
    notes: scoreNotes,
    source: { id: score?.id || score?.title || 'piano-hero-chart' },
    tempoMap,
    fallbackBpm: score?.tempo || 90,
    activeParts: options.activeParts,
  });
  const targets = expectation.events.filter((event) => event.notes.length).map((event) => {
    const onsetMs = msAtQuarter(expectation.tempoMap, event.onsetQuarter);
    const offMs = msAtQuarter(expectation.tempoMap, event.onsetQuarter + event.durationQuarters);
    const measures = [...new Set(event.notes.map((note) => note.measureIndex ?? note.measure).filter(Number.isFinite))].sort((a, b) => a - b);
    return {
      id: event.id,
      assessmentEventId: event.id,
      onsetQuarter: event.onsetQuarter,
      pitches: [...new Set(event.notes.map((note) => note.midi))].sort((a, b) => a - b),
      staves: [...new Set(event.notes.map((note) => note.staff).filter(Number.isInteger))].sort((a, b) => a - b),
      measureIndex: measures.length === 1 ? measures[0] : null,
      targetTimeMs: cfg.leadInMs + onsetMs,
      durationMs: Math.max(90, offMs - onsetMs),
    };
  });

  const pitches = targets.flatMap((target) => target.pitches);
  return {
    expectation,
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
  const attempt = startAssessmentAttempt(createAssessmentAttempt({
    matcher: 'timed', mode: 'cued', purpose: 'practice', expectation: chart?.expectation,
    clock: 'piano-hero',
    policy: {
      matchWindowMs: HERO_DEFAULTS.goodWindowMs,
      missWindowMs: HERO_DEFAULTS.missWindowMs,
      timingToleranceMs: HERO_DEFAULTS.perfectWindowMs,
      timingWindowMs: HERO_DEFAULTS.goodWindowMs - HERO_DEFAULTS.perfectWindowMs,
    },
    requirement: { rubric: { id: 'piano-hero-v2', version: '2', criteria: {} } },
  }), { time: 0, leadInMs: chart?.leadInMs || 0, clock: 'piano-hero' });
  return {
    targets: (chart?.targets || []).map((target) => ({ ...target, state: 'pending', hitPitches: [], drifts: [], resolvedAt: null, result: null })),
    attempt,
    score: { points: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, misses: 0, wrong: 0 },
  };
}

// The ceiling has to clear the fastest written chart times the top practice
// step, or the picker lies: Super Mario is charted at 216 BPM, and against a
// 220 ceiling every step above 100% produced the identical speed while the
// sheet advertised a different BPM for each. 400 covers 175% of the fastest
// charts we have and still refuses a nonsense tempo from a malformed score.
export function clampHeroTempo(bpm) {
  return Math.max(40, Math.min(400, Math.round(Number(bpm) || 90)));
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
    ...(chart.expectation ? {
      expectation: {
        ...chart.expectation,
        tempoMap: chart.expectation.tempoMap.map((entry) => ({ ...entry, bpm: entry.bpm * (nextTempo / sourceTempo) })),
      },
    } : {}),
    durationMs: leadInMs + (chart.durationMs - leadInMs) * ratio,
  };
}

/** Judge one note-on against the nearest still-available matching target. */
export function applyHeroPress(run, pitch, elapsedMs, options = {}) {
  const cfg = { ...HERO_DEFAULTS, ...options };
  if (!Number.isFinite(cfg.perfectWindowMs)) cfg.perfectWindowMs = HERO_DEFAULTS.perfectWindowMs;
  if (!Number.isFinite(cfg.goodWindowMs)) cfg.goodWindowMs = HERO_DEFAULTS.goodWindowMs;
  if (!Number.isFinite(cfg.missWindowMs)) cfg.missWindowMs = HERO_DEFAULTS.missWindowMs;
  const current = { ...run.attempt, policy: { ...run.attempt.policy, matchWindowMs: cfg.goodWindowMs, missWindowMs: cfg.missWindowMs } };
  const judged = observeAssessment(current, { midi: pitch, time: elapsedMs, clock: 'piano-hero' });
  if (judged.event.type === 'wrong') {
    return { ...run, attempt: judged.attempt, score: { ...run.score, combo: 0, wrong: run.score.wrong + 1 } };
  }
  if (!['hit', 'onset_complete'].includes(judged.event.type)) return { ...run, attempt: judged.attempt };
  const targetIndex = run.targets.findIndex((target) => target.assessmentEventId === judged.event.eventId);
  if (targetIndex < 0) return { ...run, attempt: judged.attempt };
  const targets = run.targets.map((target, index) => index === targetIndex ? {
    ...target,
    hitPitches: [...new Set([...target.hitPitches, pitch])],
    drifts: [...target.drifts, judged.event.driftMs],
    ...(judged.event.type === 'onset_complete' ? {
      state: 'hit', resolvedAt: elapsedMs,
      result: Math.abs(judged.event.driftMs) <= cfg.perfectWindowMs ? 'perfect' : 'good',
    } : {}),
  } : target);
  if (judged.event.type === 'hit') return { ...run, attempt: judged.attempt, targets };

  const result = Math.abs(judged.event.driftMs) <= cfg.perfectWindowMs ? 'perfect' : 'good';
  const combo = run.score.combo + 1;
  const multiplier = Math.min(2, 1 + Math.floor(combo / 10) * 0.25);
  const base = result === 'perfect' ? 1000 : 600;
  return { ...run, attempt: judged.attempt, targets, score: {
      ...run.score,
      points: run.score.points + Math.round(base * multiplier),
      combo,
      maxCombo: Math.max(run.score.maxCombo, combo),
      [result]: run.score[result] + 1,
  } };
}

/** Resolve targets whose timing window has passed. */
export function advanceHeroRun(run, elapsedMs, options = {}) {
  const cfg = { ...HERO_DEFAULTS, ...options };
  if (!Number.isFinite(cfg.missWindowMs)) cfg.missWindowMs = HERO_DEFAULTS.missWindowMs;
  const current = { ...run.attempt, policy: { ...run.attempt.policy, missWindowMs: cfg.missWindowMs } };
  const advanced = advanceAssessment(current, elapsedMs);
  const missedEvents = new Set(advanced.events.filter((event) => event.type === 'miss').map((event) => event.eventId));
  const targets = run.targets.map((target) => missedEvents.has(target.assessmentEventId) && target.state === 'pending'
    ? { ...target, state: 'missed', resolvedAt: elapsedMs, result: 'missed' }
    : target);
  const misses = targets.filter((target, index) => target.state === 'missed' && run.targets[index].state === 'pending').length;
  if (!misses) return { ...run, attempt: advanced.attempt, targets };
  return { ...run, attempt: advanced.attempt, targets, score: { ...run.score, combo: 0, misses: run.score.misses + misses } };
}

export function heroAccuracy(run) {
  const resolved = run?.score?.perfect + run?.score?.good + run?.score?.misses;
  if (!resolved) return 0;
  return Math.round(((run.score.perfect + run.score.good) / resolved) * 100);
}

/** Portable musical assessment; Hero's points/combo remain a separate projection. */
export function heroAssessment(run, options = {}) {
  if (!run?.attempt) return null;
  const result = finalizeAssessmentAttempt(run.attempt, { status: 'completed' }).result;
  return {
    ...result,
    diagnostics: {
      ...result.diagnostics,
      perfect_targets: run.score?.perfect ?? 0,
      good_targets: run.score?.good ?? 0,
      ...options.diagnostics,
    },
  };
}

export default { buildHeroChart, createHeroRun, applyHeroPress, advanceHeroRun, heroAccuracy, heroAssessment, clampHeroTempo, retimeHeroChart };
