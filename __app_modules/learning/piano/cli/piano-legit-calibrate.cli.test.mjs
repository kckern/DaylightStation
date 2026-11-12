import { describe, it, expect, vi } from 'vitest';
import { calibrationBursts, runCalibration, main } from './piano-legit-calibrate.cli.mjs';

describe('piano-legit-calibrate', () => {
  it('builds a deterministic labelled set: 60 engaged, 60 mash, 40 preschool', () => {
    const a = calibrationBursts();
    const b = calibrationBursts();
    expect(a.filter((x) => x.cohort === 'school' && x.label)).toHaveLength(60);
    expect(a.filter((x) => !x.label)).toHaveLength(60);
    expect(a.filter((x) => x.cohort === 'preschool')).toHaveLength(40);
    expect(a.every((x) => x.events.length >= 8 && x.events.length <= 40)).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a perfect gateway passes; the state is only notes + stats', async () => {
    const bursts = calibrationBursts({ perLabel: 6 });
    const states = [];
    const gw = { evaluate: vi.fn(async (state) => {
      states.push(state);
      const i = states.length - 1;
      return { answers: { legit: { probability: bursts[i].label ? 0.95 : 0.05 } } };
    }) };
    const r = await runCalibration({ bursts, decisionGateway: gw, concurrency: 1 });
    expect(r.modelAccuracy).toBe(1);
    expect(r.passes).toBe(true);
    expect(states.every((s) => Object.keys(s).sort().join() === 'notes,stats')).toBe(true);
  });

  it('main prints the report with a fake runtime', async () => {
    let out = '';
    const gw = { evaluate: async () => ({ answers: { legit: { probability: 0.5 } } }) };
    const code = await main(['--per-label', '3'], { loadRuntime: async () => ({ decisionGateway: gw }), stdout: { write: (s) => { out += s; } }, stderr: { write() {} } });
    expect(code).toBe(0);
    const r = JSON.parse(out);
    expect(r.passes).toBe(false);
    expect(r.n).toBeGreaterThan(0);
  });
});
