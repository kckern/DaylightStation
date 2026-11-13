import { describe, it, expect, vi } from 'vitest';
import { simulateCheckIns, calibrationSittings, runCalibration, summarise, main, BAR } from './piano-goodfaith-calibrate.cli.mjs';

describe('simulateCheckIns', () => {
  it('opens one answered check-in per 90 s without a note; the second in a row asks for a scale', () => {
    expect(simulateCheckIns([], 300, { scaleCap: 2 })).toEqual([
      { atMs: 90000, scales: 0, answered: true },
      { atMs: 180000, scales: 1, answered: true },
      { atMs: 270000, scales: 2, answered: true },
    ]);
    expect(simulateCheckIns([10, 50, 100], 120, { scaleCap: 2 })).toEqual([]);
    expect(simulateCheckIns([100], 300, { scaleCap: 2 }).map((c) => c.atMs)).toEqual([90000, 190000, 280000]);
  });
  it('preschool never escalates past a note', () => {
    expect(simulateCheckIns([], 300, { scaleCap: 0 }).every((c) => c.scales === 0)).toBe(true);
  });
});

describe('calibrationSittings', () => {
  it('labels every audit sitting plus the synthetic mash; credit for engaged + low-touch only', () => {
    const items = calibrationSittings();
    expect(items).toHaveLength(415 + 6);
    const by = (label) => items.filter((i) => i.label === label);
    expect(by('engaged')).toHaveLength(313);
    expect(by('absentee')).toHaveLength(60);
    expect(by('low-touch')).toHaveLength(30);
    expect(by('rhythm-loop')).toHaveLength(12);
    expect(by('mash')).toHaveLength(6);
    expect(items.filter((i) => i.expectCredit).every((i) => ['engaged', 'low-touch'].includes(i.label))).toBe(true);
    for (const i of items) expect(Object.keys(i.state).sort()).toEqual(['lesson', 'notes', 'perMinute', 'presence']);
    expect(JSON.stringify(calibrationSittings({ limit: 3 }))).toBe(JSON.stringify(calibrationSittings({ limit: 3 })));
  });
});

describe('runCalibration / summarise', () => {
  const items = calibrationSittings({ limit: 4 });
  it('a gateway that knows the answer passes; each state is the minimal MIDI log', async () => {
    const seen = [];
    const gw = { evaluate: vi.fn(async (state, questions) => {
      seen.push({ state, questions });
      const it = items.find((i) => i.state === state);
      const top = it.expectCredit ? 5 : 0;
      return { model: 'm', usage: { inputTokens: 1000, outputTokens: 10 }, answers: { goodFaith: { type: 'score', score: top, probabilities: [0, 1, 2, 3, 4, 5].map((k) => (k === top ? 1 : 0)) } } };
    }) };
    const r = await runCalibration({ items, decisionGateway: gw, concurrency: 2, costOf: () => 0.0001 });
    expect(r.passes).toBe(true);
    expect(r.overall.accuracy).toBe(1);
    expect(r.school.falseDrillRate).toBe(0);
    expect(r.cost.perSittingUsd).toBeCloseTo(0.0001, 6);
    expect(seen.every((s) => s.questions.goodFaith.type === 'score')).toBe(true);
    expect(seen.find((s) => s.state.lesson.preschool).questions.goodFaith.instructions).toMatch(/small child/);
  });
  it('a gateway that drills everyone fails the false-drill bar', async () => {
    const gw = { evaluate: async () => ({ answers: { goodFaith: { score: 0, probabilities: [1, 0, 0, 0, 0, 0] } } }) };
    const r = await runCalibration({ items, decisionGateway: gw, concurrency: 2 });
    expect(r.passes).toBe(false);
    expect(r.school.falseDrillRate).toBe(1);
  });
  it('summarise applies each cohort\'s own pass score and reports the deterministic fallback too', () => {
    const rows = [
      { label: 'engaged', cohort: 'preschool', expectCredit: true, score: 3.5, fallback: true },
      { label: 'absentee', cohort: 'preschool', expectCredit: false, score: 2, fallback: true },
      { label: 'engaged', cohort: 'school', expectCredit: true, score: 5.9, fallback: true },
      { label: 'absentee', cohort: 'school', expectCredit: false, score: 0, fallback: false },
    ];
    const r = summarise(rows);
    expect(r.preschool).toMatchObject({ falseDrillRate: 0, absenteeCaught: 1 });
    expect(r.school).toMatchObject({ falseDrillRate: 1, absenteeCaught: 1 });
    expect(r.fallback.school.absenteeCaught).toBe(1);
    expect(r.fallback.preschool.absenteeCaught).toBe(0);
    expect(BAR).toEqual({ falseDrillMax: 0.05, absenteeCaughtMin: 0.9, errorRateMax: 0.02 });
  });
  it('main prints the report with a fake runtime', async () => {
    let out = '';
    const gw = { evaluate: async () => ({ answers: { goodFaith: { score: 5, probabilities: [0, 0, 0, 0, 0, 1] } } }) };
    const code = await main(['--limit', '2'], { loadRuntime: async () => ({ decisionGateway: gw, costOf: () => 0 }), stdout: { write: (s) => { out += s; } }, stderr: { write() {} } });
    expect(code).toBe(0);
    expect(JSON.parse(out).passes).toBe(false);
  });
});
