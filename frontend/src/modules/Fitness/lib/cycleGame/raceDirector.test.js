import { describe, it, expect } from 'vitest';
import { raceDirector } from './raceDirector.js';

const base = (over = {}) => ({
  fieldSize: 2, isSolo: false, lapsEnabled: false, phase: 'MID',
  leaderGapM: 100, lapDeltaMax: 0, tightestPairGapM: 50, events: [], ...over
});

describe('raceDirector zone assignment', () => {
  it('solo with laps: no rankings/chart, lap table promoted up top', () => {
    const snap = base({ fieldSize: 1, isSolo: true, lapsEnabled: true });
    const d = raceDirector(snap, null, 10);
    expect(d.zones.bottom).toBe('speedoRow');
    const top = [d.zones.topLeft, d.zones.topCenter, d.zones.topRight];
    expect(top).toContain('lapTable');
    expect(top).not.toContain('rankings');
    expect(top).not.toContain('distanceChart');
  });

  it('human + ghost: rankings present (ghost counts as a competitor)', () => {
    const d = raceDirector(base({ fieldSize: 2 }), null, 10);
    const top = [d.zones.topLeft, d.zones.topCenter, d.zones.topRight];
    expect(top).toContain('rankings');
  });
});

describe('raceDirector transient camera', () => {
  it('promotes camera on event and HOLDS it for minHoldS after the event clears', () => {
    const fired = base({ lapsEnabled: true, fieldSize: 2, lapDeltaMax: 1, events: [{ type: 'LAPPING_IMMINENT' }] });
    const d1 = raceDirector(fired, null, 10);
    expect(d1.zones.topCenter).toBe('cameraZoom');
    // event gone at t=12 (within 6s hold) → still showing
    const d2 = raceDirector(base({ lapsEnabled: true, fieldSize: 2, events: [] }), d1, 12);
    expect(d2.zones.topCenter).toBe('cameraZoom');
    // t=17 (> 6s after shownAt=10) → released
    const d3 = raceDirector(base({ lapsEnabled: true, fieldSize: 2, events: [] }), d2, 17);
    expect(d3.zones.topCenter).not.toBe('cameraZoom');
  });

  it('respects cooldown — will not re-fire within cooldownS of release', () => {
    const fire = base({ lapsEnabled: true, fieldSize: 2, events: [{ type: 'LAPPING_IMMINENT' }] });
    const d1 = raceDirector(fire, null, 10);
    const d3 = raceDirector(base({ lapsEnabled: true, fieldSize: 2, events: [] }), d1, 17); // released
    const d4 = raceDirector(fire, d3, 19); // event again, but < cooldown(10) since show
    expect(d4.zones.topCenter).not.toBe('cameraZoom');
  });
});

describe('raceDirector stability', () => {
  it('does not swap an incumbent for a near-equal challenger (hysteresis)', () => {
    // two panels competing for topCenter with close scores across ticks
    const s = base({ fieldSize: 2, lapsEnabled: true });
    const d1 = raceDirector(s, null, 10);
    const incumbent = d1.zones.topCenter;
    const d2 = raceDirector(s, d1, 11);
    expect(d2.zones.topCenter).toBe(incumbent); // no thrash on identical input
  });
});
