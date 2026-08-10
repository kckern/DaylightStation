import { describe, expect, it } from 'vitest';
import {
  advanceHeroRun,
  applyHeroPress,
  buildHeroChart,
  createHeroRun,
  heroAccuracy,
  retimeHeroChart,
} from './heroChart.js';

const score = {
  tempo: 120,
  parts: [{
    notes: [
      { midi: 60, onsetQuarter: 0, durationQuarters: 1 },
      { midi: 64, onsetQuarter: 1, durationQuarters: 1 },
      { midi: 67, onsetQuarter: 1, durationQuarters: 1, chord: true },
      { midi: 72, onsetQuarter: 2, durationQuarters: 2, tie: 'start' },
      { midi: 72, onsetQuarter: 4, durationQuarters: 2, tie: 'stop' },
      { rest: true, onsetQuarter: 6, durationQuarters: 1 },
    ],
  }],
};

describe('Piano Hero chart', () => {
  it('retimes target onsets and durations without changing the lead-in', () => {
    const original = buildHeroChart(score, { leadInMs: 3000 });
    const slower = retimeHeroChart(original, 60);

    expect(slower.leadInMs).toBe(3000);
    expect(slower.targets[0].targetTimeMs).toBe(3000);
    expect(slower.targets[1].targetTimeMs - 3000)
      .toBeCloseTo((original.targets[1].targetTimeMs - 3000) * 2);
    expect(slower.targets[0].durationMs).toBeCloseTo(original.targets[0].durationMs * 2);
  });

  it('groups MusicXML chord onsets and honors score tempo', () => {
    const chart = buildHeroChart(score, { leadInMs: 3000 });
    expect(chart.targets).toHaveLength(3);
    expect(chart.targets[0]).toMatchObject({ pitches: [60], targetTimeMs: 3000, durationMs: 500 });
    expect(chart.targets[1]).toMatchObject({ pitches: [64, 67], targetTimeMs: 3500 });
    expect(chart.targets[2]).toMatchObject({ pitches: [72], targetTimeMs: 4000, durationMs: 1000 });
  });

  it('does not turn tie continuations or rests into new attacks', () => {
    const chart = buildHeroChart(score);
    expect(chart.targets.flatMap((target) => target.pitches)).toEqual([60, 64, 67, 72]);
  });

  it('uses the score tempo map for mid-piece changes', () => {
    const chart = buildHeroChart({
      ...score,
      tempoEntries: [{ onsetQuarter: 0, bpm: 120 }, { onsetQuarter: 1, bpm: 60 }],
    }, { leadInMs: 0 });
    expect(chart.targets[0].targetTimeMs).toBe(0);
    expect(chart.targets[1].targetTimeMs).toBe(500);
    expect(chart.targets[2].targetTimeMs).toBe(1500);
  });
});

describe('Piano Hero judging', () => {
  const chart = buildHeroChart(score, { leadInMs: 0 });

  it('requires every pitch of a chord before resolving it', () => {
    let run = createHeroRun(chart);
    run = applyHeroPress(run, 64, 500);
    expect(run.targets[1].state).toBe('pending');
    run = applyHeroPress(run, 67, 540);
    expect(run.targets[1]).toMatchObject({ state: 'hit', result: 'perfect' });
    expect(run.score).toMatchObject({ perfect: 1, combo: 1, points: 1000 });
  });

  it('chooses the nearest repeated-pitch target', () => {
    const repeated = { targets: [
      { id: 1, pitches: [60], targetTimeMs: 1000, durationMs: 200 },
      { id: 2, pitches: [60], targetTimeMs: 1300, durationMs: 200 },
    ] };
    const run = applyHeroPress(createHeroRun(repeated), 60, 1240);
    expect(run.targets[0].state).toBe('pending');
    expect(run.targets[1].state).toBe('hit');
  });

  it('marks expired targets missed and computes hit accuracy', () => {
    let run = createHeroRun(chart);
    run = applyHeroPress(run, 60, 0);
    run = advanceHeroRun(run, 2000);
    expect(run.score).toMatchObject({ perfect: 1, misses: 2, combo: 0 });
    expect(heroAccuracy(run)).toBe(33);
  });

  it('resets the streak for an unrelated key without stealing a target', () => {
    let run = createHeroRun(chart);
    run = applyHeroPress(run, 60, 0);
    run = applyHeroPress(run, 61, 40);
    expect(run.score).toMatchObject({ combo: 0, wrong: 1, perfect: 1 });
    expect(run.targets[1].state).toBe('pending');
  });

  it('does not consume a target struck outside the good window', () => {
    const run = applyHeroPress(createHeroRun(chart), 64, 800);
    expect(run.targets[1].state).toBe('pending');
    expect(run.score.wrong).toBe(1);
  });
});
