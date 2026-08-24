import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const logged = [];
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({
    info: (e, d) => logged.push(['info', e, d]),
    warn: (e, d) => logged.push(['warn', e, d]),
    debug: (e, d) => logged.push(['debug', e, d]),
    sampled: (e, d) => logged.push(['sampled', e, d]),
  }) }),
}));

import { useScoreTelemetry } from './useScoreTelemetry.js';

beforeEach(() => { logged.length = 0; });

describe('useScoreTelemetry', () => {
  it('emits score.load with phase breakdown', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logLoad({ fetchMs: 10, parseMs: 5, engraveMs: 200, extractMs: 80, totalMs: 300, steps: 40, measures: 12, staves: 2, osmdWarm: true }));
    const ev = logged.find(([, e]) => e === 'score.load');
    expect(ev[2]).toMatchObject({ id: 'x', engraveMs: 200, totalMs: 300 });
  });

  // Audit L2: a load-failure emitter here was unreachable by construction — the
  // XML fetch lives in SheetMusic.jsx's NotationScore, and a failure renders
  // PianoEmpty instead of ScorePlayer, so this hook never exists on that path.
  // The failure is logged at the real failure site instead.
  it('exposes no load-failure emitter — the failure path never mounts this hook', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    expect(result.current.logLoadFailed).toBeUndefined();
    expect(logged.some(([, e]) => e === 'score.load.failed')).toBe(false);
  });

  it('does not flag a healthy tick gap as a stall', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x', tickMs: 100 }));
    // 100ms gap is the tick interval BY DESIGN; 40ms drift at 90bpm is well
    // inside the ~167ms budget. Neither is a stall.
    act(() => { result.current.recordFire({ step: 3 }, 40, 100, 90); });
    expect(logged.some(([, e]) => e === 'score.playback.stall')).toBe(false);
    act(() => result.current.flushPlayback('listen'));
    expect(logged.find(([, e]) => e === 'score.playback.stats')[2].stalls).toBe(0);
  });

  it('flags a gap that skipped whole ticks', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x', tickMs: 100 }));
    act(() => { result.current.recordFire({ step: 3 }, 10, 400, 90); });
    expect(logged.some(([, e]) => e === 'score.playback.stall')).toBe(true);
  });

  it('flags drift past the tempo-scaled budget, and emits it at debug', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x', tickMs: 100 }));
    // 200ms drift at 216bpm — budget there is ~69ms.
    act(() => { result.current.recordFire({ step: 3 }, 200, 100, 216); });
    const ev = logged.find(([, e]) => e === 'score.playback.stall');
    expect(ev).toBeTruthy();
    expect(ev[0]).toBe('debug'); // NOT warn — this fires per tick on a bad run
    act(() => result.current.flushPlayback('polish'));
    expect(logged.find(([, e]) => e === 'score.playback.stats')[2].stalls).toBe(1);
  });

  it('scales the drift budget with the tempo it is handed', () => {
    // Same 100ms drift, two tempi: inside the ~167ms budget at 90bpm, past the
    // ~83ms budget at 180. Callers must therefore hand it the EFFECTIVE tempo
    // (written bpm x tempoMult) — see ScorePlayer.telemetry.test.jsx.
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x', tickMs: 100 }));
    act(() => { result.current.recordFire({ step: 1 }, 100, 100, 90); });
    expect(logged.some(([, e]) => e === 'score.playback.stall')).toBe(false);
    act(() => { result.current.recordFire({ step: 2 }, 100, 100, 180); });
    const ev = logged.find(([, e]) => e === 'score.playback.stall');
    expect(ev).toBeTruthy();
    expect(ev[2]).toMatchObject({ step: 2, effectiveBpm: 180, stallMs: 83 });
  });

  it('caps sched-late warns per run but counts them all in stats', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => {
      for (let i = 0; i < 20; i++) result.current.recordSchedule({ note: 60 }, -100);
      result.current.flushPlayback('listen');
    });
    const warns = logged.filter(([lvl, e]) => lvl === 'warn' && e === 'score.playback.sched-late');
    expect(warns.length).toBe(5);
    expect(logged.find(([, e]) => e === 'score.playback.stats')[2].schedLate).toBe(20);
  });

  it('collects schedule leads and reports them in playback stats', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => {
      result.current.recordSchedule({ note: 60 }, 350);
      result.current.recordSchedule({ note: 62 }, 120);
      result.current.recordSchedule({ note: 64 }, -20);
      result.current.flushPlayback('listen');
    });
    const stats = logged.find(([, e]) => e === 'score.playback.stats')[2];
    expect(stats.meanLeadMs).toBe(150);
    expect(stats.minLeadMs).toBe(-20);
    expect(stats.schedLate).toBe(1);
    expect(stats.scheduled).toBe(3);
    const warn = logged.find(([lvl, e]) => lvl === 'warn' && e === 'score.playback.sched-late');
    expect(warn).toBeTruthy();
    expect(warn[2]).toMatchObject({ leadMs: -20 });
    expect(warn[2]).not.toHaveProperty('note');
  });

  it('does not emit a stats record for a run that produced nothing', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.flushPlayback('polish'));
    expect(logged.some(([, e]) => e === 'score.playback.stats')).toBe(false);
  });

  it('startSession opens a session log', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.startSession('score-1'));
    const ev = logged.find(([, e]) => e === 'session-log.start');
    expect(ev).toBeTruthy();
    expect(ev[2]).toMatchObject({ scoreId: 'score-1' });
  });

  it('logMeasureGrade emits score.polish.measure', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logMeasureGrade({ measure: 3, grade: 'green', noteScore: 1, timingScore: 0.95 }));
    const ev = logged.find(([, e]) => e === 'score.polish.measure');
    expect(ev[2]).toMatchObject({ measure: 3, grade: 'green' });
  });

  it('logRunSummary emits score.polish.summary', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logRunSummary({ greens: 5, yellows: 2, reds: 1, overall: 'green' }));
    const ev = logged.find(([, e]) => e === 'score.polish.summary');
    expect(ev[2]).toMatchObject({ greens: 5, yellows: 2, reds: 1, overall: 'green' });
  });

  it('logRunSummary carries the tempo-tier outcome: score, tier and the void flag (wave-3 H)', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logRunSummary({ greens: 3, yellows: 0, reds: 0, overall: 'green', score: 113, tier: 'overclocked', mixed: false }));
    const ev = logged.find(([, e]) => e === 'score.polish.summary');
    expect(ev[2]).toMatchObject({ score: 113, tier: 'overclocked', mixed: false });
  });

  it('logRunSummary is null-safe for a run with nothing gradeable', () => {
    // A tally-only caller must still produce the tier keys, or a log reader cannot
    // tell "no score" from "this build did not report scores".
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logRunSummary({ greens: 0, yellows: 0, reds: 0, overall: null }));
    const ev = logged.find(([, e]) => e === 'score.polish.summary');
    expect(ev[2]).toMatchObject({ score: null, tier: null, mixed: false });
    expect(Object.keys(ev[2])).toEqual(expect.arrayContaining(['score', 'tier', 'mixed']));
  });

  it('logFocus emits score.focus.set', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logFocus({ kind: 'section', inMeasure: 2, outMeasure: 6 }));
    const ev = logged.find(([, e]) => e === 'score.focus.set');
    expect(ev[2]).toMatchObject({ kind: 'section', inMeasure: 2, outMeasure: 6 });
  });

  it('logTranspose emits score.transpose', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logTranspose({ semitones: -3 }));
    const ev = logged.find(([, e]) => e === 'score.transpose');
    expect(ev[2]).toMatchObject({ semitones: -3 });
  });

  // Learn is self-paced, so the follow telemetry reports the user's OWN pacing
  // and passes NO verdict — no driftMs, no feel (audit M5b).
  it('records a follow hit as a raw step interval, with no classification', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.recordFollowHit({ step: 4, note: 60, sinceAdvanceMs: 812.6 }));
    const ev = logged.find(([, e]) => e === 'score.follow.timing');
    expect(ev[0]).toBe('sampled');
    expect(ev[2]).toMatchObject({ step: 4, sinceAdvanceMs: 813 });
    expect(ev[2]).not.toHaveProperty('note');
    expect(ev[2]).not.toHaveProperty('feel');
    expect(ev[2]).not.toHaveProperty('driftMs');
    expect(ev[2]).not.toHaveProperty('expectedMs');
  });

  it('flushFollow summarizes the run\'s own step intervals', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => {
      [100, 200, 300, 400, 10000].forEach((ms, i) => result.current.recordFollowHit({ step: i, note: 60 + i, sinceAdvanceMs: ms }));
      result.current.flushFollow(5, 2);
    });
    const ev = logged.find(([, e]) => e === 'score.follow.stats');
    expect(ev[2]).toMatchObject({ hits: 5, wrongs: 2, count: 5, medianStepMs: 300, p95StepMs: 10000 });
    expect(ev[2]).not.toHaveProperty('rushPct');
    expect(ev[2]).not.toHaveProperty('meanAbsDriftMs');
  });

  it('flushFollow clears the collector so the next run starts clean', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => {
      result.current.recordFollowHit({ step: 0, note: 60, sinceAdvanceMs: 900 });
      result.current.flushFollow(1, 0);
      result.current.flushFollow(0, 3);
    });
    const stats = logged.filter(([, e]) => e === 'score.follow.stats');
    expect(stats[1][2]).toMatchObject({ count: 0, medianStepMs: 0, p95StepMs: 0 });
  });

  it('logMode emits score.mode', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logMode({ mode: 'polish' }));
    const ev = logged.find(([, e]) => e === 'score.mode');
    expect(ev[2]).toMatchObject({ mode: 'polish' });
  });
});
