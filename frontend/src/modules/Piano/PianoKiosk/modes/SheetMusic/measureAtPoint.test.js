import { describe, it, expect } from 'vitest';
import { measureAtPoint } from './measureAtPoint.js';

// Two systems: steps 0-3 at y 100-160, steps 4-7 at y 300-360. One measure per 2 steps.
const events = [
  { x: 100, top: 100, bottom: 160 }, { x: 200, top: 100, bottom: 160 },
  { x: 300, top: 100, bottom: 160 }, { x: 400, top: 100, bottom: 160 },
  { x: 100, top: 300, bottom: 360 }, { x: 200, top: 300, bottom: 360 },
  { x: 300, top: 300, bottom: 360 }, { x: 400, top: 300, bottom: 360 },
];
const measures = [
  { index: 0, firstStep: 0, lastStep: 1 }, { index: 1, firstStep: 2, lastStep: 3 },
  { index: 2, firstStep: 4, lastStep: 5 }, { index: 3, firstStep: 6, lastStep: 7 },
];

describe('measureAtPoint', () => {
  it('maps any x in a system to the nearest measure column', () => {
    expect(measureAtPoint({ events, measures, x: 120, y: 130 })).toBe(0);
    expect(measureAtPoint({ events, measures, x: 999, y: 130 })).toBe(1);  // far right still resolves
    expect(measureAtPoint({ events, measures, x: 250, y: 340 })).toBe(2);  // second system
  });

  it('rejects dead margins between systems', () => {
    expect(measureAtPoint({ events, measures, x: 200, y: 230 })).toBe(-1);
  });

  it('slack admits taps just above/below the staves', () => {
    expect(measureAtPoint({ events, measures, x: 200, y: 175, slack: 40 })).toBe(0);
  });

  it('empty geometry rejects', () => {
    expect(measureAtPoint({ events: [], measures, x: 1, y: 1 })).toBe(-1);
  });

  // Endpoint picking is COARSE by design (wave-3 F): unlike the retired two-tap
  // flow there is no near-a-note radius, so a tap far to the RIGHT of the last
  // note in a system still commits that system's last measure rather than being
  // swallowed. This is the behaviour change the retired L3 threshold test guarded
  // the opposite of.
  it('has no near-a-note radius — a far-right tap commits, it is never swallowed', () => {
    expect(measureAtPoint({ events, measures, x: 5000, y: 130 })).toBe(1);
    expect(measureAtPoint({ events, measures, x: -5000, y: 340 })).toBe(2);
  });

  it('rejects a tap with no measure model to resolve against', () => {
    expect(measureAtPoint({ events, measures: [], x: 120, y: 130 })).toBe(-1);
  });

  it('defaults tolerate being called with nothing at all', () => {
    expect(measureAtPoint({ x: 0, y: 0 })).toBe(-1);
  });
});
