import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));

import useInvadersAim, { createAimTracker } from './useInvadersAim.js';
import { KP } from '../../lib/skylineInvaders/aim.js';
import { laneAim } from '../../lib/skylineInvaders/lanes.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import { handsPose, poseForAim, poseForLane, standingPose, wiperPose } from './invadersTestKit.js';

const make = (gesture = 'wiper', tunables = INVADERS_TUNABLES) => {
  let t = 10_000;
  const tracker = createAimTracker({ tunables, now: () => t, gesture });
  // Feed the same pose for `ms`, a frame every 80 ms, the way the camera does.
  const hold = (pose, ms = 800) => { for (let elapsed = 0; elapsed < ms; elapsed += 80) { t += 80; tracker.processPoses([pose]); } };
  return { tracker, hold, tick: (ms) => { t += ms; }, feed: (pose) => tracker.processPoses([pose]), at: () => t };
};

describe('createAimTracker', () => {
  describe('presence (what the lobby reads)', () => {
    it('is empty before any pose', () => {
      expect(make().tracker.presence()).toEqual({ body: false, wide: null });
    });
    it('sees the body from head and shoulders alone, with no usable arm', () => {
      const { tracker, feed } = make();
      feed(standingPose());
      expect(tracker.presence()).toEqual({ body: true, wide: null });
    });
    it('reports arms held out to both sides', () => {
      const { tracker, feed } = make();
      feed(handsPose([-1.6, 1.6]));
      expect(tracker.presence().wide).toBe(true);
      feed(handsPose(0.5));
      expect(tracker.presence().wide).toBe(false);
    });
    it('forgets a pose older than the lost timeout, and does not count a body with no head in view', () => {
      const { tracker, feed, tick } = make();
      feed(wiperPose());
      tick(INVADERS_TUNABLES.poseLostAfterMs + 1);
      expect(tracker.presence()).toEqual({ body: false, wide: null });
      const headless = wiperPose();
      headless.keypoints[KP.nose].score = 0;
      feed(headless);
      expect(tracker.presence().body).toBe(false);
    });
  });

  it('returns undefined from processPoses so the provider records no move event', () => {
    expect(make().tracker.processPoses([wiperPose()])).toBeUndefined();
  });

  it('starts in manual mode, centred, and switches to pose mode once the camera has seen a torso', () => {
    const { tracker, feed } = make();
    expect(tracker.sample()).toMatchObject({ mode: 'manual', lost: true, lane: 4, x: laneAim(4), gesture: 'wiper' });
    feed(wiperPose());
    expect(tracker.sample()).toMatchObject({ mode: 'pose', lost: false });
  });

  describe('lanes', () => {
    it('stands the cannon on the centre of the lane the gesture points at', () => {
      const { tracker, hold } = make();
      hold(poseForLane(6));
      expect(tracker.sample()).toMatchObject({ lane: 6, x: laneAim(6) });
      expect(tracker.sample().raw).toBeCloseTo(laneAim(6), 2);
      hold(poseForLane(1));
      expect(tracker.sample().lane).toBe(1);
    });
    it('reaches both edge lanes', () => {
      const { tracker, hold } = make();
      hold(wiperPose(50));
      expect(tracker.sample().lane).toBe(7);
      hold(wiperPose(-50));
      expect(tracker.sample().lane).toBe(0);
    });
    it('holds its lane against a small wobble across the boundary', () => {
      const { tracker, hold } = make();
      hold(poseForLane(3));
      // Lane 3 ends at 0.5: a wobble to 0.52 is inside the quarter-lane hysteresis.
      hold(poseForAim(0.52));
      expect(tracker.sample().lane).toBe(3);
      hold(poseForAim(0.56));
      expect(tracker.sample().lane).toBe(4);
    });
    it('freezes the lane for a moment after a mat step, while the raw aim keeps moving', () => {
      const { tracker, hold, at, feed, tick } = make();
      hold(poseForLane(3));
      tracker.freezeLane(150, at());
      tick(80); feed(poseForLane(6));
      tick(60); feed(poseForLane(6));
      expect(tracker.sample().lane).toBe(3);
      expect(tracker.sample().raw).toBeGreaterThan(0.5);
      hold(poseForLane(6), 400);
      expect(tracker.sample().lane).toBe(6);
    });
    it('a zero freeze is off', () => {
      const { tracker, hold, at } = make();
      hold(poseForLane(3));
      tracker.freezeLane(0, at());
      hold(poseForLane(6), 400);
      expect(tracker.sample().lane).toBe(6);
    });
  });

  describe('lost and held', () => {
    it('arms that drop only hold the aim: the player is not lost while the torso is in view', () => {
      const { tracker, hold } = make();
      hold(poseForLane(6));
      hold(standingPose(), 3000);
      expect(tracker.sample()).toMatchObject({ lane: 6, lost: false, mode: 'pose' });
    });
    it('reports lost after the torso has been gone for the timeout, keeping the aim', () => {
      const { tracker, hold, feed, tick } = make();
      const heard = [];
      tracker.subscribe((event) => heard.push(event));
      hold(poseForLane(6));
      tick(100); feed(null);
      expect(tracker.sample().lost).toBe(false);
      tick(INVADERS_TUNABLES.poseLostAfterMs); feed(null);
      expect(tracker.sample()).toMatchObject({ lost: true, lane: 6, mode: 'pose' });
      feed(wiperPose());
      expect(tracker.sample().lost).toBe(false);
      expect(heard).toEqual(['acquired', 'lost', 'acquired']);
    });
    it('reports lost when the pose stream itself stops arriving', () => {
      const { tracker, hold, tick } = make();
      hold(poseForLane(2));
      tick(INVADERS_TUNABLES.poseLostAfterMs + 1);
      expect(tracker.sample().lost).toBe(true);
    });
    it('manual aim moves the cannon through the lanes, and a live pose takes over again', () => {
      const { tracker, hold } = make();
      tracker.setAim(0.95);
      expect(tracker.sample()).toMatchObject({ lane: 7, raw: 0.95 });
      tracker.setAim(4);
      expect(tracker.sample().raw).toBe(1);
      hold(poseForLane(2));
      expect(tracker.sample().lane).toBe(2);
    });
  });

  it('arms-up counts only after it has been held for the hold time', () => {
    const { tracker, feed, tick } = make();
    const up = handsPose(0.2, { drop: -0.5 });
    feed(up);
    expect(tracker.sample().armsUp).toBe(false);
    tick(INVADERS_TUNABLES.armsUpHoldMs); feed(up);
    expect(tracker.sample().armsUp).toBe(true);
    tick(80); feed(handsPose(0.2, { drop: 0.5 }));
    expect(tracker.sample().armsUp).toBe(false);
  });

  it('gives a lane per arm for a two-cannon level, from a gesture that reads each arm', () => {
    const { tracker, hold } = make();
    const split = wiperPose(0);
    // Left forearm tilted hard to screen left, right forearm hard to screen right.
    split.keypoints[KP.leftWrist] = { x: 390 + 61, y: 300 - 51, score: 0.9 };
    split.keypoints[KP.rightWrist] = { x: 250 - 61, y: 300 - 51, score: 0.9 };
    hold(split);
    expect(tracker.sample().perArm).toEqual([laneAim(0), laneAim(7)]);
    const { tracker: drag, hold: holdDrag } = make('drag');
    holdDrag(handsPose(0.5));
    expect(drag.sample().perArm).toEqual([null, null]);
  });

  describe('gesture kinds', () => {
    it('plays the gesture it was made with, falls back to the default, and switches without moving the cannon', () => {
      expect(make('twist').tracker.gesture()).toBe('twist');
      expect(make('telekinesis').tracker.gesture()).toBe('wiper');
      const { tracker, hold } = make();
      hold(poseForLane(6));
      tracker.setGesture('hop');
      expect(tracker.sample()).toMatchObject({ gesture: 'hop', lane: 6 });
      tracker.setGesture('nope');
      expect(tracker.gesture()).toBe('hop');
    });
    it('drag: a hand held out slides the cannon, and dropping it stops the cannon where it is', () => {
      const { tracker, hold } = make('drag');
      hold(handsPose(1), 400);          // full speed right: 0.8 screens a second
      const moved = tracker.sample().raw;
      expect(moved).toBeGreaterThan(0.7);
      expect(moved).toBeLessThan(0.9);
      hold(handsPose(0.1), 800);        // inside the dead zone
      expect(tracker.sample().raw).toBeCloseTo(moved);
      hold(handsPose(1, { drop: 1.5 }), 800);   // arms down
      expect(tracker.sample().raw).toBeCloseTo(moved);
      hold(handsPose(-1), 2000);
      expect(tracker.sample()).toMatchObject({ raw: 0, lane: 0 });
    });
    it('push: a swipe shoves the cannon, it glides on, and it comes to rest on a lane centre', () => {
      const { tracker, feed, tick, hold } = make('push');
      feed(handsPose(0.1)); tick(80);
      feed(handsPose(0.5)); tick(80);
      feed(handsPose(0.9));
      const during = tracker.sample().raw;
      expect(during).toBeGreaterThan(0.5);
      hold(handsPose(0.9), 240);        // the hand has stopped: the cannon glides on
      expect(tracker.sample().raw).toBeGreaterThan(during);
      hold(handsPose(0.9), 2000);
      const rest = tracker.sample();
      expect(rest.raw).toBeCloseTo(laneAim(rest.lane));
      expect(rest.lane).toBeGreaterThan(4);
      const settled = rest.raw;
      hold(handsPose(0.9), 1000);       // a still hand does nothing
      expect(tracker.sample().raw).toBe(settled);
    });
    it('push: bringing the hand back does not pull the cannon back', () => {
      const { tracker, feed, tick, hold } = make('push');
      feed(handsPose(0.1)); tick(80); feed(handsPose(0.6)); tick(80); feed(handsPose(1.1));
      hold(handsPose(1.1), 2000);
      const rest = tracker.sample().lane;
      tick(80); feed(handsPose(0.6)); tick(80); feed(handsPose(0.1));
      hold(handsPose(0.1), 1000);
      expect(tracker.sample().lane).toBe(rest);
    });
    it('hop: each trigger moves the cannon exactly one lane, and it stops at the edge', () => {
      const { tracker, hold } = make('hop');
      const DOWN = handsPose([-0.6, 0.6], { drop: 1.4 });
      const RIGHT_UP = handsPose([-0.6, 0.6], { drop: [1.4, 0] });
      const LEFT_OUT = handsPose([-1.5, 0.6], { drop: [0.6, 1.4] });
      hold(DOWN, 400);
      expect(tracker.sample().lane).toBe(4);
      hold(RIGHT_UP, 400);
      expect(tracker.sample()).toMatchObject({ lane: 5, raw: laneAim(5) });
      hold(DOWN, 400); hold(RIGHT_UP, 400); hold(DOWN, 400); hold(RIGHT_UP, 400); hold(DOWN, 400); hold(RIGHT_UP, 400);
      expect(tracker.sample().lane).toBe(7);
      hold(DOWN, 400); hold(LEFT_OUT, 400);
      expect(tracker.sample().lane).toBe(6);
    });
  });

  it('keeps the last pose and every gesture\'s reading of it for the trace recorder', () => {
    const { tracker, feed, at } = make('twist');
    expect(tracker.frame()).toBeNull();
    const pose = wiperPose(25);
    feed(pose);
    const frame = tracker.frame();
    expect(frame.at).toBe(at());
    expect(frame.pose).toBe(pose);
    expect(frame.signals.wiper.aim).toBeCloseTo(0.75);
    expect(frame.signals).toHaveProperty('offset');
    expect(frame.signals).toHaveProperty('push');
    expect(frame.signals).toHaveProperty('hop');
  });
});

describe('useInvadersAim', () => {
  it('returns one stable tracker and logs pose acquired / lost with the lane and the gesture', () => {
    const { result, rerender, unmount } = renderHook(() => useInvadersAim({ gesture: 'wings' }));
    const tracker = result.current;
    rerender();
    expect(result.current).toBe(tracker);
    tracker.processPoses([wiperPose()]);
    expect(mockLog.info).toHaveBeenCalledWith('skyline_invaders.pose.acquired', expect.objectContaining({ lane: expect.any(Number), gesture: 'wings' }));
    unmount();
  });
});
