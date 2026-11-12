import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));

import useInvadersAim, { createAimTracker } from './useInvadersAim.js';
import { KP } from '../../lib/skylineInvaders/aim.js';

// 33 BlazePose keypoints by index. Shoulders at x 380 / 260 (width 120, midline 320), y 200.
// Both wrists sit wristDx px from their own shoulder: wristDx < 0 = toward image-left = the
// player's right = screen right. Default height is the chest; wristY < 200 is above the shoulders.
const pose = (wristDx = 0, score = 0.9, wristY = 200) => {
  const keypoints = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  keypoints[KP.leftShoulder] = { x: 380, y: 200, score };
  keypoints[KP.rightShoulder] = { x: 260, y: 200, score };
  keypoints[KP.leftWrist] = { x: 380 + wristDx, y: wristY, score };
  keypoints[KP.rightWrist] = { x: 260 + wristDx, y: wristY, score };
  return { keypoints };
};
const tunables = { aimLatchMs: 200, keypointMinScore: 0.3, poseLostAfterMs: 500, armsUpHoldMs: 300 };
const make = () => {
  let t = 10_000;
  const tracker = createAimTracker({ tunables, now: () => t });
  tracker.setCalibration({ left: -1, right: 1 });
  return { tracker, tick: (ms) => { t += ms; }, at: () => t };
};

describe('createAimTracker', () => {
  describe('presence (what the lobby reads, calibrated or not)', () => {
    const fresh = () => { let t = 10_000; return { tracker: createAimTracker({ tunables, now: () => t }), tick: (ms) => { t += ms; } }; };
    const withHead = (p, score = 0.9) => { p.keypoints[KP.nose] = { x: 320, y: 120, score }; return p; };
    it('is empty before any pose', () => {
      expect(fresh().tracker.presence()).toEqual({ body: false, offset: null, wide: null });
    });
    it('sees the body from head and shoulders alone, with no usable arm', () => {
      const { tracker } = fresh();
      tracker.processPoses([withHead(pose(0, 0.9, 200))].map((p) => { p.keypoints[KP.leftWrist].score = 0; p.keypoints[KP.rightWrist].score = 0; return p; }));
      expect(tracker.presence()).toEqual({ body: true, offset: null, wide: null });
    });
    it('reports the raw offset in shoulder widths without a calibration', () => {
      const { tracker } = fresh();
      tracker.processPoses([withHead(pose(-120))]);
      expect(tracker.presence().body).toBe(true);
      expect(tracker.presence().offset).toBeCloseTo(1);
      expect(tracker.presence().wide).toBe(false);
    });
    it('reports arms held out to both sides', () => {
      const { tracker } = fresh();
      const p = withHead(pose());
      p.keypoints[KP.leftWrist] = { x: 380 + 130, y: 200, score: 0.9 };
      p.keypoints[KP.rightWrist] = { x: 260 - 130, y: 200, score: 0.9 };
      tracker.processPoses([p]);
      expect(tracker.presence().wide).toBe(true);
    });
    it('forgets a pose older than the lost timeout', () => {
      const { tracker, tick } = fresh();
      tracker.processPoses([withHead(pose(-120))]);
      tick(501);
      expect(tracker.presence()).toEqual({ body: false, offset: null, wide: null });
    });
    it('does not count a body with no head in view', () => {
      const { tracker } = fresh();
      tracker.processPoses([pose(-120)]);
      expect(tracker.presence().body).toBe(false);
    });
  });
  it('returns undefined from processPoses so the provider records no move event', () => {
    const { tracker } = make();
    expect(tracker.processPoses([pose()])).toBeUndefined();
  });
  it('reports a centred aim for hands in front of the chest, in pose mode', () => {
    const { tracker } = make();
    tracker.processPoses([pose()]);
    expect(tracker.sample()).toMatchObject({ lost: false, mode: 'pose' });
    expect(tracker.sample().x).toBeCloseTo(0.5);
  });
  it('keeps the last aim through a low-score pose and reports lost after the timeout', () => {
    const { tracker, tick } = make();
    const events = [];
    tracker.subscribe((event) => events.push(event));
    tracker.processPoses([pose(-80)]);
    const held = tracker.sample().x;
    tick(100); tracker.processPoses([pose(-80, 0.05)]);
    expect(tracker.sample()).toMatchObject({ x: held, lost: false });
    tick(600); tracker.processPoses([]);
    expect(tracker.sample()).toMatchObject({ x: held, lost: true });
    tick(50); tracker.processPoses([pose(-80)]);
    expect(tracker.sample().lost).toBe(false);
    expect(events).toEqual(['acquired', 'lost', 'acquired']);
  });
  it('reports lost when the pose stream itself stops arriving', () => {
    const { tracker, tick } = make();
    const events = [];
    tracker.subscribe((event) => events.push(event));
    tracker.processPoses([pose(-80)]);
    const held = tracker.sample().x;
    tick(400);
    expect(tracker.sample().lost).toBe(false);
    tick(200);                                    // 600 ms with no frame at all
    expect(tracker.sample()).toMatchObject({ x: held, lost: true });
    tracker.sample();
    expect(events).toEqual(['acquired', 'lost']);
  });
  it('latches the aim from before the press', () => {
    const { tracker, tick, at } = make();
    tracker.processPoses([pose(-100)]);           // t0: aiming right
    const before = tracker.sample().x;
    tick(250); tracker.processPoses([pose(100)]); // the step throws the aim left
    expect(tracker.sample().x).toBeLessThan(before);
    expect(tracker.latched(at()).x).toBeCloseTo(before, 1);
  });
  it('arms-up counts only after it has been held for the hold time at the latched moment', () => {
    const { tracker, tick, at } = make();
    tracker.processPoses([pose(0, 0.9, 80)]);
    tick(100); tracker.processPoses([pose(0, 0.9, 80)]);
    expect(tracker.latched(at() + 200).armsUp).toBe(false);   // held 100 ms at the latched moment
    tick(400); tracker.processPoses([pose(0, 0.9, 80)]);
    tick(200); tracker.processPoses([pose(0, 0.9, 80)]);
    expect(tracker.latched(at()).armsUp).toBe(true);          // held 500 ms by then
    tick(50); tracker.processPoses([pose(0, 0.9, 300)]);      // arms drop to the waist
    tick(250); tracker.processPoses([pose(0, 0.9, 300)]);
    expect(tracker.latched(at()).armsUp).toBe(false);
  });
  it('a lost pose ends the arms-up hold', () => {
    const { tracker, tick, at } = make();
    tracker.processPoses([pose(0, 0.9, 80)]);
    tick(400); tracker.processPoses([pose(0, 0.9, 80)]);
    tick(700); tracker.processPoses([]);                      // lost
    tick(300); tracker.processPoses([]);
    expect(tracker.sample()).toMatchObject({ lost: true, armsUp: false });
    expect(tracker.latched(at()).armsUp).toBe(false);
  });
  it('smooths each arm for a two-cannon level', () => {
    const { tracker, tick } = make();
    tracker.processPoses([pose(-60)]);
    const [left0, right0] = tracker.sample().perArm;
    expect(left0).toBeLessThan(right0);                       // player's left arm = left cannon
    tick(80); tracker.processPoses([pose(60)]);
    const [left1, right1] = tracker.sample().perArm;
    expect(left1).toBeLessThan(left0);
    expect(left1).toBeGreaterThan(0);                         // raw would be 0: the jump is eased
    expect(right1).toBeLessThan(right0);
  });
  it('without calibration it has no pose aim; manual nudges still move it', () => {
    let t = 0;
    const tracker = createAimTracker({ tunables, now: () => t });
    tracker.processPoses([pose()]);
    expect(tracker.sample()).toMatchObject({ x: 0.5, mode: 'manual' });
    tracker.nudge(0.2);
    expect(tracker.sample().x).toBeCloseTo(0.7);
    tracker.setAim(2);
    expect(tracker.sample().x).toBe(1);
  });
  it('manual aim is not latched back in time', () => {
    let t = 0;
    const tracker = createAimTracker({ tunables, now: () => t });
    tracker.setAim(0.2);
    t += 300; tracker.setAim(0.8);
    expect(tracker.latched(t + 100).x).toBeCloseTo(0.8);   // 200 ms earlier it was 0.2
  });
  it('exposes the uncalibrated offset for calibration capture', () => {
    const { tracker } = make();
    tracker.processPoses([pose(-90)]);
    expect(tracker.rawOffset()).toBeCloseTo(0.75);   // 90 px / 120 px shoulder width, toward screen right
  });
  it('captures the offset before any calibration exists', () => {
    const tracker = createAimTracker({ tunables, now: () => 0 });
    tracker.processPoses([pose(-90)]);
    expect(tracker.rawOffset()).toBeCloseTo(0.75);
  });
});

describe('useInvadersAim', () => {
  it('returns one stable tracker and logs pose acquired / lost', () => {
    const { result, rerender, unmount } = renderHook(() => useInvadersAim({ tunables }));
    const tracker = result.current;
    rerender();
    expect(result.current).toBe(tracker);
    tracker.setCalibration({ left: -1, right: 1 });
    tracker.processPoses([pose()]);
    expect(mockLog.info).toHaveBeenCalledWith('skyline_invaders.pose.acquired', expect.any(Object));
    unmount();
  });
});
