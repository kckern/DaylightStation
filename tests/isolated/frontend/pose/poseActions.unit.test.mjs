// tests/isolated/frontend/pose/poseActions.unit.test.mjs
import { jest } from '@jest/globals';
import { createActionDetector, createCustomActionDetector } from '../../../../frontend/src/modules/Fitness/lib/pose/poseActions.js';

const JUMPING_JACK = {
  id: 'jumping-jack',
  name: 'Jumping Jack',
  phases: [
    { name: 'open',   match: { handsUp: true } },
    { name: 'closed', match: { handsUp: false } },
  ],
  timing: {
    minCycleMs: 400,
    maxCycleMs: 3000,
    maxPhaseMs: 2000,
  },
};

const PLANK = {
  id: 'plank',
  name: 'Plank',
  sustain: { bodyProne: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },
};

describe('createActionDetector — cyclic (rep-counted)', () => {
  test('initial state: 0 reps, not active', () => {
    const det = createActionDetector(JUMPING_JACK);
    const result = det.update({ handsUp: false, bodyUpright: true }, 1000);
    expect(result.repCount).toBe(0);
    expect(result.active).toBe(false);
  });

  test('one full cycle: closed → open → closed = 1 rep', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ handsUp: false }, 1000);   // start closed
    det.update({ handsUp: true }, 1500);    // open
    const r = det.update({ handsUp: false }, 2000);  // closed again = 1 rep
    expect(r.repCount).toBe(1);
  });

  test('three full cycles = 3 reps', () => {
    const det = createActionDetector(JUMPING_JACK);
    let t = 1000;
    det.update({ handsUp: false }, t);
    for (let i = 0; i < 3; i++) {
      t += 500;
      det.update({ handsUp: true }, t);
      t += 500;
      det.update({ handsUp: false }, t);
    }
    const r = det.update({ handsUp: false }, t + 100);
    expect(r.repCount).toBe(3);
  });

  test('too-fast cycle (< minCycleMs) is rejected', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ handsUp: false }, 1000);
    det.update({ handsUp: true }, 1100);    // only 100ms
    const r = det.update({ handsUp: false }, 1200);  // only 200ms total
    expect(r.repCount).toBe(0);
  });

  test('too-slow phase (> maxPhaseMs) resets cycle', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ handsUp: false }, 1000);
    det.update({ handsUp: true }, 1500);
    // Stay in open phase for > maxPhaseMs (2000ms)
    const r = det.update({ handsUp: false }, 4000);
    expect(r.repCount).toBe(0);
  });

  test('reset() clears rep count', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ handsUp: false }, 1000);
    det.update({ handsUp: true }, 1500);
    det.update({ handsUp: false }, 2000);
    expect(det.update({ handsUp: false }, 2100).repCount).toBe(1);
    det.reset();
    expect(det.update({ handsUp: false }, 3000).repCount).toBe(0);
  });

  test('has id property matching pattern', () => {
    const det = createActionDetector(JUMPING_JACK);
    expect(det.id).toBe('jumping-jack');
  });
});

describe('createActionDetector — sustained (hold)', () => {
  test('initial state: not holding', () => {
    const det = createActionDetector(PLANK);
    const r = det.update({ bodyProne: false, armsExtended: true }, 1000);
    expect(r.holding).toBe(false);
    expect(r.holdDurationMs).toBe(0);
  });

  test('tracks hold duration while matching', () => {
    const det = createActionDetector(PLANK);
    det.update({ bodyProne: true, armsExtended: true }, 1000);
    const r = det.update({ bodyProne: true, armsExtended: true }, 6000);
    expect(r.holding).toBe(true);
    expect(r.holdDurationMs).toBe(5000);
  });

  test('brief wobble within grace period does not break hold', () => {
    const det = createActionDetector(PLANK);
    det.update({ bodyProne: true, armsExtended: true }, 1000);
    det.update({ bodyProne: true, armsExtended: true }, 3000);
    det.update({ bodyProne: false, armsExtended: true }, 3100);  // wobble
    const r = det.update({ bodyProne: true, armsExtended: true }, 3300);
    expect(r.holding).toBe(true);
    expect(r.holdDurationMs).toBeGreaterThan(2000);
  });

  test('loss exceeding grace period breaks hold', () => {
    const det = createActionDetector(PLANK);
    det.update({ bodyProne: true, armsExtended: true }, 1000);
    det.update({ bodyProne: true, armsExtended: true }, 3000);
    det.update({ bodyProne: false, armsExtended: true }, 3100);
    const r = det.update({ bodyProne: false, armsExtended: true }, 3700);
    expect(r.holding).toBe(false);
    expect(r.holdDurationMs).toBe(0);
  });

  test('reset() clears hold state', () => {
    const det = createActionDetector(PLANK);
    det.update({ bodyProne: true, armsExtended: true }, 1000);
    det.update({ bodyProne: true, armsExtended: true }, 5000);
    det.reset();
    const r = det.update({ bodyProne: false, armsExtended: true }, 6000);
    expect(r.holding).toBe(false);
    expect(r.holdDurationMs).toBe(0);
  });

  test('has id property matching pattern', () => {
    const det = createActionDetector(PLANK);
    expect(det.id).toBe('plank');
  });
});

describe('createCustomActionDetector', () => {
  test('calls detect with position, history, and timestamp', () => {
    const detectFn = jest.fn(() => ({ active: true, customField: 42 }));
    const det = createCustomActionDetector({
      id: 'custom',
      detect: detectFn,
    });
    const pos = { handsUp: true };
    det.update(pos, 1000);
    expect(detectFn).toHaveBeenCalledTimes(1);
    expect(detectFn.mock.calls[0][0]).toEqual(pos);
    expect(detectFn.mock.calls[0][1]).toHaveLength(1);
    expect(detectFn.mock.calls[0][2]).toBe(1000);
  });

  test('accumulates history up to maxHistory', () => {
    let capturedHistory;
    const det = createCustomActionDetector({
      id: 'custom',
      maxHistory: 3,
      detect: (pos, history) => { capturedHistory = history; return { active: false }; },
    });
    det.update({ a: 1 }, 100);
    det.update({ a: 2 }, 200);
    det.update({ a: 3 }, 300);
    det.update({ a: 4 }, 400);
    expect(capturedHistory).toHaveLength(3);
    expect(capturedHistory[0].position).toEqual({ a: 2 });
  });

  test('reset clears history', () => {
    let capturedHistory;
    const det = createCustomActionDetector({
      id: 'custom',
      detect: (pos, history) => { capturedHistory = history; return { active: false }; },
    });
    det.update({ a: 1 }, 100);
    det.update({ a: 2 }, 200);
    det.reset();
    det.update({ a: 3 }, 300);
    expect(capturedHistory).toHaveLength(1);
  });

  test('has id property matching definition', () => {
    const det = createCustomActionDetector({ id: 'my-custom', detect: () => ({}) });
    expect(det.id).toBe('my-custom');
  });

  test('returns default when detect returns falsy', () => {
    const det = createCustomActionDetector({ id: 'x', detect: () => null });
    const r = det.update({}, 100);
    expect(r.active).toBe(false);
  });
});

describe('createActionDetector — dispatch', () => {
  test('throws for pattern without phases or sustain', () => {
    expect(() => createActionDetector({ id: 'bad' })).toThrow();
  });
});
