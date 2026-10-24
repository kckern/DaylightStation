/**
 * hrPlausibility — shared HR floor/ceiling used by the timeline + metrics
 * recorders. Guards against phantom-strap ghosts (e.g. the 11 BPM device:28690
 * leak observed 2026-06-05) reaching the recorded session series.
 */
import { describe, it, expect } from 'vitest';

import {
  sanitizeHeartRate, MIN_PLAUSIBLE_HR, MAX_PLAUSIBLE_HR,
  createHrSlewGate, HR_SLEW_MAX_DELTA_BPM, HR_SLEW_WINDOW_MS
} from "./hrPlausibility.js";

describe('sanitizeHeartRate', () => {
  it('rejects the phantom-strap lows that leaked into the timeline (11, 10, 2)', () => {
    expect(sanitizeHeartRate(11)).toBeNull();
    expect(sanitizeHeartRate(10)).toBeNull();
    expect(sanitizeHeartRate(2)).toBeNull();
  });

  it('rejects zero and negatives', () => {
    expect(sanitizeHeartRate(0)).toBeNull();
    expect(sanitizeHeartRate(-5)).toBeNull();
  });

  it('rejects readings below the floor and above the ceiling', () => {
    expect(sanitizeHeartRate(MIN_PLAUSIBLE_HR - 1)).toBeNull();
    expect(sanitizeHeartRate(MAX_PLAUSIBLE_HR + 1)).toBeNull();
  });

  it('keeps real readings, including a hard-effort youth max (207)', () => {
    expect(sanitizeHeartRate(69)).toBe(69);
    expect(sanitizeHeartRate(129)).toBe(129);
    expect(sanitizeHeartRate(207)).toBe(207);
  });

  it('keeps the inclusive boundaries', () => {
    expect(sanitizeHeartRate(MIN_PLAUSIBLE_HR)).toBe(MIN_PLAUSIBLE_HR);
    expect(sanitizeHeartRate(MAX_PLAUSIBLE_HR)).toBe(MAX_PLAUSIBLE_HR);
  });

  it('rounds fractional readings and rejects non-numeric / nullish input', () => {
    expect(sanitizeHeartRate(72.4)).toBe(72);
    expect(sanitizeHeartRate(null)).toBeNull();
    expect(sanitizeHeartRate(undefined)).toBeNull();
    expect(sanitizeHeartRate('abc')).toBeNull();
  });
});

/**
 * 2026-10-23: two straps each sent ONE 204 bpm packet in the middle of a steady
 * reading (152,152,204,153 and 111,204,110). Both became Fire ceremonies. A real
 * effort climbs 1-3 bpm/s, so a >=25 bpm jump inside 2s is held until a second
 * sample confirms it.
 */
describe('createHrSlewGate', () => {
  const feed = (gate, samples, stepMs = 250) => samples.map((hr, i) => gate.evaluate('d1', hr, 1000 + i * stepMs));

  it('holds a lone spike and rejects it when the next sample returns to the steady line (Rider A)', () => {
    const gate = createHrSlewGate();
    const out = feed(gate, [152, 152, 204, 153, 153]);
    expect(out.map(r => r.verdict)).toEqual(['accept', 'accept', 'suspect', 'rejected', 'accept']);
    expect(out[2]).toMatchObject({ hr: null, heldHr: 204, previousHr: 152 });
    expect(out[3]).toMatchObject({ hr: 153, heldHr: 204 });
  });

  it('holds Rider B\'s Cool-to-Fire spike (111, 204, 110)', () => {
    const gate = createHrSlewGate();
    expect(feed(gate, [111, 204, 110]).map(r => r.hr)).toEqual([111, null, 110]);
  });

  it('confirms a real jump when the next sample agrees with the held one', () => {
    const gate = createHrSlewGate();
    const out = feed(gate, [100, 140, 141]);
    expect(out.map(r => r.verdict)).toEqual(['accept', 'suspect', 'confirmed']);
    expect(out[2].hr).toBe(141);
  });

  it('never holds a genuine fast climb (3 bpm/s at 4 Hz)', () => {
    const gate = createHrSlewGate();
    const climb = Array.from({ length: 40 }, (_, i) => 120 + Math.round(i * 0.75));
    expect(feed(gate, climb).every(r => r.verdict === 'accept')).toBe(true);
  });

  it('does not compare against a reading older than the window', () => {
    const gate = createHrSlewGate();
    gate.evaluate('d1', 100, 0);
    expect(gate.evaluate('d1', 160, HR_SLEW_WINDOW_MS + 1).verdict).toBe('accept');
  });

  it('accepts a jump after a short silent gap provisionally, and drops it if the next sample returns to the old line', () => {
    // 2026-10-24 audit: a spike after a 2-5s radio gap became the baseline.
    const gate = createHrSlewGate();
    gate.evaluate('d1', 152, 0);
    const t = HR_SLEW_WINDOW_MS + 1500;
    expect(gate.evaluate('d1', 204, t)).toMatchObject({ verdict: 'accept', hr: 204, provisional: true, priorHr: 152 });
    expect(gate.evaluate('d1', 152, t + 1000)).toMatchObject({ verdict: 'rejected', hr: 152, heldHr: 204 });
    expect(gate.evaluate('d1', 153, t + 2000).verdict).toBe('accept');
  });

  it('keeps a real post-gap change once the next sample agrees with it', () => {
    const gate = createHrSlewGate();
    gate.evaluate('d1', 100, 0);
    expect(gate.evaluate('d1', 160, 6000)).toMatchObject({ verdict: 'accept', provisional: true });
    expect(gate.evaluate('d1', 161, 7000)).toMatchObject({ verdict: 'accept', hr: 161 });
    // No longer provisional: a return toward 100 is now an ordinary held jump.
    expect(gate.evaluate('d1', 100, 8000).verdict).toBe('suspect');
  });

  it('never lets a 204/real alternation after a gap keep the spike as the baseline', () => {
    const gate = createHrSlewGate();
    gate.evaluate('d1', 152, 0);
    const out = [];
    for (let i = 0; i < 20; i += 1) out.push(gate.evaluate('d1', i % 2 === 0 ? 204 : 152, 3500 + i * 1000).hr);
    // At most the one provisional reading gets through; never two in a row.
    expect(out.filter((hr) => hr === 204).length).toBeLessThanOrEqual(1);
    expect(out.filter((hr) => hr === 152)).toHaveLength(10);
  });

  it('treats a jump just under the limit as plausible and keeps devices independent', () => {
    const gate = createHrSlewGate();
    gate.evaluate('d1', 100, 0);
    gate.evaluate('d2', 180, 0);
    expect(gate.evaluate('d1', 100 + HR_SLEW_MAX_DELTA_BPM - 1, 250).verdict).toBe('accept');
    expect(gate.evaluate('d2', 181, 250).verdict).toBe('accept');
  });

  it('forgets a device on reset', () => {
    const gate = createHrSlewGate();
    gate.evaluate('d1', 100, 0);
    gate.reset('d1');
    expect(gate.evaluate('d1', 180, 250).verdict).toBe('accept');
  });
});
