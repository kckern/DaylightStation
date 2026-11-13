import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }) }) }));

import useInvadersTryout from './useInvadersTryout.js';
import { GESTURES } from '../../lib/skylineInvaders/gestures.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import { createAimTracker } from './useInvadersAim.js';
import { poseForLane, wiperPose } from './invadersTestKit.js';

let tracker;
// Hold a pose for `ms`, a frame every 100 ms, with the clock moving.
const hold = (pose, ms) => { for (let t = 0; t < ms; t += 100) act(() => { tracker.processPoses(pose ? [pose] : []); vi.advanceTimersByTime(100); }); };
const lit = (result) => result.current.targets.map((target) => [target.id, target.lit, target.reached]);

function mount(over = {}) {
  const props = { active: true, tracker, current: null, onTryout: vi.fn(), onCard: vi.fn(), onTick: vi.fn(), ...over };
  const hook = renderHook((p) => useInvadersTryout(p), { initialProps: props });
  return { props, ...hook };
}

beforeEach(() => { vi.useFakeTimers(); tracker = createAimTracker(); });
afterEach(() => vi.useRealTimers());

describe('useInvadersTryout', () => {
  it('opens on the first card and hands the tracker its gesture', () => {
    const { result, props } = mount();
    expect(result.current).toMatchObject({ gesture: 'wiper', index: 0, reached: 0, leftS: INVADERS_TUNABLES.tryoutCardS, leftPct: 100 });
    expect(tracker.gesture()).toBe('wiper');
    expect(props.onCard).toHaveBeenCalledWith('wiper', 0);
  });

  it('opens on the gesture the defender already has', () => {
    const { result } = mount({ current: 'sprinkler' });
    expect(result.current.gesture).toBe('sprinkler');
    expect(tracker.gesture()).toBe('sprinkler');
  });

  it('does nothing while the screen is not up: the tracker keeps its gesture', () => {
    tracker.setGesture('hop');
    const { props } = mount({ active: false });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(tracker.gesture()).toBe('hop');
    expect(props.onCard).not.toHaveBeenCalled();
    expect(props.onTryout).not.toHaveBeenCalled();
  });

  it('walks all eight cards and wraps, forward and back, logging each one as it closes', () => {
    const { result, props } = mount();
    const seen = [result.current.gesture];
    for (let i = 0; i < 8; i += 1) { act(() => result.current.go(1, 'step')); seen.push(result.current.gesture); }
    expect(seen).toEqual([...GESTURES, 'wiper']);
    act(() => result.current.go(-1, 'button'));
    expect(result.current.gesture).toBe('hop');
    expect(tracker.gesture()).toBe('hop');
    expect(props.onTryout).toHaveBeenCalledTimes(9);
    expect(props.onTryout.mock.calls[0][0]).toMatchObject({ gesture: 'wiper', how: 'step' });
    expect(props.onTryout.mock.calls[8][0]).toMatchObject({ gesture: 'wiper', how: 'button' });
  });

  it('the real cannon follows the gesture and lights each practice target it rests on', () => {
    const { result, props } = mount();
    hold(wiperPose(0), 300);
    expect(lit(result)[0]).toEqual(['left', false, false]);
    hold(poseForLane(0), 1200);
    expect(result.current.lane).toBe(0);
    expect(lit(result)[0]).toEqual(['left', true, true]);
    expect(result.current.reached).toBe(1);
    hold(poseForLane(7), 1200);
    hold(poseForLane(4), 1200);
    expect(result.current.reached).toBe(3);
    let picked;
    act(() => { picked = result.current.choose('stomp'); });
    expect(picked).toBe('wiper');
    const summary = props.onTryout.mock.calls[0][0];
    expect(summary).toMatchObject({ gesture: 'wiper', how: 'chosen-stomp', reached: 3 });
    expect(summary.leftMs).toBeLessThan(summary.rightMs);
    expect(summary.rightMs).toBeLessThan(summary.centreMs);
    expect(props.onTick).toHaveBeenCalled();
  });

  it('moves on by itself after the card time, so eight cards cannot take five minutes', () => {
    const { result, props } = mount();
    act(() => { vi.advanceTimersByTime(INVADERS_TUNABLES.tryoutCardS * 1000 - 200); });
    expect(result.current.gesture).toBe('wiper');
    expect(result.current.leftS).toBeLessThanOrEqual(1);
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current.gesture).toBe('twist');
    expect(props.onTryout).toHaveBeenCalledTimes(1);
    expect(props.onTryout.mock.calls[0][0]).toMatchObject({ how: 'timeout', reached: 0 });
    expect(INVADERS_TUNABLES.tryoutCardS * GESTURES.length).toBeLessThanOrEqual(180);
  });

  it('says when nobody is in view, and logs a close', () => {
    const { result, props } = mount();
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.lost).toBe(true);
    hold(wiperPose(0), 200);
    expect(result.current.lost).toBe(false);
    act(() => result.current.close());
    expect(props.onTryout.mock.calls[0][0]).toMatchObject({ gesture: 'wiper', how: 'closed' });
  });
});
