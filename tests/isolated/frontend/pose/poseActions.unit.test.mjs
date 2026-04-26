// tests/isolated/frontend/pose/poseActions.unit.test.mjs
import { vi } from 'vitest';
import { createActionDetector, createCustomActionDetector } from '../../../../frontend/src/modules/Fitness/lib/pose/poseActions.js';

const JUMPING_JACK = {
  id: 'jumping-jack',
  name: 'Jumping Jack',
  phases: [
    { name: 'open',   match: { armsOverhead: true, wideStance: true } },
    { name: 'closed', match: { armsAtSides: true, narrowStance: true, upright: true } },
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
  sustain: { prone: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },
};

describe('createActionDetector — cyclic (rep-counted)', () => {
  test('initial state: 0 reps, not active', () => {
    const det = createActionDetector(JUMPING_JACK);
    const result = det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1000);
    expect(result.repCount).toBe(0);
    expect(result.active).toBe(false);
  });

  test('one full cycle: closed → open → closed = 1 rep', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1000);   // start closed
    det.update({ armsOverhead: true, wideStance: true }, 1500);    // open
    const r = det.update({ armsAtSides: true, narrowStance: true, upright: true }, 2000);  // closed again = 1 rep
    expect(r.repCount).toBe(1);
  });

  test('three full cycles = 3 reps', () => {
    const det = createActionDetector(JUMPING_JACK);
    let t = 1000;
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, t);
    for (let i = 0; i < 3; i++) {
      t += 500;
      det.update({ armsOverhead: true, wideStance: true }, t);
      t += 500;
      det.update({ armsAtSides: true, narrowStance: true, upright: true }, t);
    }
    const r = det.update({ armsAtSides: true, narrowStance: true, upright: true }, t + 100);
    expect(r.repCount).toBe(3);
  });

  test('too-fast cycle (< minCycleMs) is rejected', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1000);
    det.update({ armsOverhead: true, wideStance: true }, 1100);    // only 100ms
    const r = det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1200);  // only 200ms total
    expect(r.repCount).toBe(0);
  });

  test('too-slow phase (> maxPhaseMs) resets cycle', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1000);
    det.update({ armsOverhead: true, wideStance: true }, 1500);
    // Stay in open phase for > maxPhaseMs (2000ms)
    const r = det.update({ armsAtSides: true, narrowStance: true, upright: true }, 4000);
    expect(r.repCount).toBe(0);
  });

  test('reset() clears rep count', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1000);
    det.update({ armsOverhead: true, wideStance: true }, 1500);
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 2000);
    expect(det.update({ armsAtSides: true, narrowStance: true, upright: true }, 2100).repCount).toBe(1);
    det.reset();
    expect(det.update({ armsAtSides: true, narrowStance: true, upright: true }, 3000).repCount).toBe(0);
  });

  test('has id property matching pattern', () => {
    const det = createActionDetector(JUMPING_JACK);
    expect(det.id).toBe('jumping-jack');
  });

  test('activityDurationMs starts at 0', () => {
    const det = createActionDetector(JUMPING_JACK);
    const r = det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1000);
    expect(r.activityDurationMs).toBe(0);
  });

  test('activityDurationMs tracks time from first phase match', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ armsOverhead: true, wideStance: true }, 1000);                  // match phase 0 (open)
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1500);  // match phase 1 (closed) = 1 rep
    const r = det.update({ armsOverhead: true, wideStance: true }, 2000);        // match phase 0 again
    expect(r.activityDurationMs).toBe(1000); // 2000 - 1000
  });

  test('activityDurationMs accumulates across multiple reps', () => {
    const det = createActionDetector(JUMPING_JACK);
    let t = 1000;
    det.update({ armsOverhead: true, wideStance: true }, t);  // match phase 0
    for (let i = 0; i < 3; i++) {
      t += 500;
      det.update({ armsAtSides: true, narrowStance: true, upright: true }, t);  // match phase 1
      t += 500;
      det.update({ armsOverhead: true, wideStance: true }, t);  // match phase 0
    }
    const r = det.update({ armsOverhead: true, wideStance: true }, t + 100);
    expect(r.activityDurationMs).toBe(t + 100 - 1000); // continuous since first match
  });

  test('activityDurationMs resets after inactivityTimeoutMs gap', () => {
    const JACK_WITH_TIMEOUT = {
      ...JUMPING_JACK,
      timing: { ...JUMPING_JACK.timing, inactivityTimeoutMs: 3000 },
    };
    const det = createActionDetector(JACK_WITH_TIMEOUT);
    // Do one rep
    det.update({ armsOverhead: true, wideStance: true }, 1000);                  // match open
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1500);  // match closed = 1 rep

    // Wait 4 seconds (exceeds 3000ms timeout), then start again
    det.update({ armsOverhead: true, wideStance: true }, 5500);                  // match open (restart)
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 6000);  // match closed = rep
    const r = det.update({ armsOverhead: true, wideStance: true }, 6500);        // match open

    // Duration should be from the restart (5500), not the original start (1000)
    expect(r.activityDurationMs).toBe(1000); // 6500 - 5500
  });

  test('activityDurationMs survives brief pauses within inactivityTimeoutMs', () => {
    const JACK_WITH_TIMEOUT = {
      ...JUMPING_JACK,
      timing: { ...JUMPING_JACK.timing, inactivityTimeoutMs: 3000 },
    };
    const det = createActionDetector(JACK_WITH_TIMEOUT);
    // Do one rep
    det.update({ armsOverhead: true, wideStance: true }, 1000);                  // match open
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1500);  // match closed = 1 rep

    // Pause 2 seconds (within 3000ms timeout), then continue
    det.update({ armsOverhead: true, wideStance: true }, 3500);                  // match open
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 4000);  // match closed = rep
    const r = det.update({ armsOverhead: true, wideStance: true }, 4500);        // match open

    // Duration should be continuous from original start
    expect(r.activityDurationMs).toBe(3500); // 4500 - 1000
  });

  test('reset() clears activityDurationMs', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 1000);
    det.update({ armsOverhead: true, wideStance: true }, 1500);
    det.update({ armsAtSides: true, narrowStance: true, upright: true }, 2000);
    det.reset();
    const r = det.update({ armsAtSides: true, narrowStance: true, upright: true }, 3000);
    expect(r.activityDurationMs).toBe(0);
  });
});

describe('createActionDetector — sustained (hold)', () => {
  test('initial state: not holding', () => {
    const det = createActionDetector(PLANK);
    const r = det.update({ prone: false, armsExtended: true }, 1000);
    expect(r.holding).toBe(false);
    expect(r.holdDurationMs).toBe(0);
  });

  test('tracks hold duration while matching', () => {
    const det = createActionDetector(PLANK);
    det.update({ prone: true, armsExtended: true }, 1000);
    const r = det.update({ prone: true, armsExtended: true }, 6000);
    expect(r.holding).toBe(true);
    expect(r.holdDurationMs).toBe(5000);
  });

  test('brief wobble within grace period does not break hold', () => {
    const det = createActionDetector(PLANK);
    det.update({ prone: true, armsExtended: true }, 1000);
    det.update({ prone: true, armsExtended: true }, 3000);
    det.update({ prone: false, armsExtended: true }, 3100);  // wobble
    const r = det.update({ prone: true, armsExtended: true }, 3300);
    expect(r.holding).toBe(true);
    expect(r.holdDurationMs).toBeGreaterThan(2000);
  });

  test('loss exceeding grace period breaks hold', () => {
    const det = createActionDetector(PLANK);
    det.update({ prone: true, armsExtended: true }, 1000);
    det.update({ prone: true, armsExtended: true }, 3000);
    det.update({ prone: false, armsExtended: true }, 3100);
    const r = det.update({ prone: false, armsExtended: true }, 3700);
    expect(r.holding).toBe(false);
    expect(r.holdDurationMs).toBe(0);
  });

  test('reset() clears hold state', () => {
    const det = createActionDetector(PLANK);
    det.update({ prone: true, armsExtended: true }, 1000);
    det.update({ prone: true, armsExtended: true }, 5000);
    det.reset();
    const r = det.update({ prone: false, armsExtended: true }, 6000);
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
    const detectFn = vi.fn(() => ({ active: true, customField: 42 }));
    const det = createCustomActionDetector({
      id: 'custom',
      detect: detectFn,
    });
    const pos = { armsOverhead: true, wideStance: true };
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
