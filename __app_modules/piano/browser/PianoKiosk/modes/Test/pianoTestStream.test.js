import { describe, it, expect } from 'vitest';
import { createSimState, stepSim, makeRng, TEST_DEFAULTS } from './pianoTestStream.js';

const P = { ...TEST_DEFAULTS, nps: 10, poly: 4, holdMs: 200, lo: 60, hi: 72, seed: 7 };

describe('pianoTestStream', () => {
  it('generates notes over time and never exceeds the polyphony cap', () => {
    const st = createSimState(P);
    for (let t = 0; t <= 1000; t += 50) stepSim(st, t, P);
    expect(st.history.length).toBeGreaterThan(0);
    expect(st.active.size).toBeLessThanOrEqual(P.poly);
  });

  it('closes notes after holdMs — active history entries match the active map', () => {
    const st = createSimState(P);
    for (let t = 0; t <= 2000; t += 25) stepSim(st, t, P);
    expect(st.active.size).toBeLessThanOrEqual(P.poly);
    const stillOpen = st.history.filter((n) => !n.endTime);
    expect(stillOpen.length).toBe(st.active.size);
  });

  it('is deterministic for a fixed seed', () => {
    const a = createSimState(P);
    const b = createSimState(P);
    for (let t = 0; t <= 1500; t += 50) { stepSim(a, t, P); stepSim(b, t, P); }
    expect(a.history.map((n) => n.note)).toEqual(b.history.map((n) => n.note));
  });

  it('keeps history bounded (trims the display window) over a long run', () => {
    const st = createSimState(P);
    for (let t = 0; t <= 20000; t += 50) stepSim(st, t, P);
    // 10 nps with 200ms holds over an 8s window is well under 200 notes.
    expect(st.history.length).toBeLessThan(200);
  });

  it('makeRng is stable and in [0,1)', () => {
    const r = makeRng(42);
    const vals = [r(), r(), r()];
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
    const r2 = makeRng(42);
    expect([r2(), r2(), r2()]).toEqual(vals);
  });
});
