import { describe, it, expect } from 'vitest';
import { compactPayload, drillResult, intervalsOf, pressRate, relayTiming } from './matMetrics.js';

describe('press rate', () => {
  it('is the count in the trailing window over the window length', () => {
    const times = [1000, 2000, 3000, 11500, 12000, 12500];
    expect(pressRate(times, 12500, 10000)).toBe(0.4); // 3000..12500 -> 4 presses / 10 s
    expect(pressRate(times, 30000, 10000)).toBe(0);
    expect(intervalsOf([0, 400, 1000])).toEqual([400, 600]);
  });
});

describe('drill', () => {
  it('reports presses per second and the sustained pace', () => {
    const times = [];
    for (let t = 500; t < 15500; t += 750) times.push(t); // 20 presses, 750 ms apart
    const r = drillResult([100, ...times, 16000], 500, 15000);
    expect(r.presses).toBe(20);
    expect(r.perSec).toBe(1.33);
    expect(r.secPerPress).toBe(0.75);
    expect(r.sustainedPerSec).toBe(1.33);
    expect(r.intervalMs.p50).toBe(750);
  });

  it('survives a drill with no presses', () => {
    const r = drillResult([], 0, 15000);
    expect(r).toMatchObject({ presses: 0, perSec: 0, secPerPress: null, sustainedPerSec: null });
  });
});

describe('relay timing', () => {
  const press = (t, deviceTs, extra = {}) => ({ t, wallMs: 1_000_000 + t, deviceTs, receivedAtMs: 1_000_000 + t - 12, bootCount: 3, ...extra });

  it('never reports an absolute press latency', () => {
    const r = relayTiming([press(5000, 90000)]);
    expect(r.absoluteLatencyMs).toBeNull();
    expect(r.note).toMatch(/not measurable/);
  });

  it('measures delivery delay above the fastest press on the device clock', () => {
    // Device presses 1000 ms apart; delivery took +40, +40, +95, +55 ms.
    const r = relayTiming([press(5040, 90000), press(6040, 91000), press(7095, 92000), press(8055, 93000)]);
    expect(r.deviceClockPresses).toBe(4);
    expect(r.deliveryExcessMs).toMatchObject({ n: 4, min: 0, max: 55, p50: 8 });
    expect(r.spacingErrorMs).toMatchObject({ n: 3, min: -40, max: 55 });
    expect(r.backendToAppMs.p50).toBe(12);
  });

  it('does not compare device clocks across a relay reboot', () => {
    const r = relayTiming([press(5000, 90000), press(6000, 500, { bootCount: 4 }), press(7010, 1500, { bootCount: 4 })]);
    expect(r.spacingErrorMs.n).toBe(1);
    expect(r.deliveryExcessMs.max).toBe(10);
  });

  it('says so when no clocks are present', () => {
    const r = relayTiming([{ t: 1, wallMs: 5, deviceTs: null, receivedAtMs: null }, { t: 500, wallMs: 505, deviceTs: 0, receivedAtMs: null }]);
    expect(r.deviceClockPresses).toBe(0);
    expect(r.backendClockPresses).toBe(0);
    expect(r.deliveryExcessMs.n).toBe(0);
    expect(r.backendToAppMs.p50).toBeNull();
  });
});

it('compacts payloads', () => {
  expect(compactPayload({ id: 'mat', event: null, steps: 0, lastReset: undefined })).toEqual({ id: 'mat', steps: 0 });
});
