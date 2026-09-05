import { describe, expect, it } from 'vitest';
import { PressureMatActivityTracker } from './PressureMatActivityTracker.js';

const reading = (event, steps, stomps, extra = {}) => ({
  id: 'mat-1', type: event ? 'presence' : 'reading', event, steps, stomps, ...extra,
});

describe('PressureMatActivityTracker', () => {
  it('retains corroborated startup deltas once, without exposing a pre-session card or losing the epoch', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    const pending = { timestamp: 2000, countSession: false, retainStartup: true, assignedUserId: 'alex' };
    tracker.ingest(reading(null, 84, 46, { bootCount: 24 }), { timestamp: 1000, countSession: false });
    tracker.ingest(reading('pressed', 85, 46, { bootCount: 24 }), pending);
    tracker.ingest(reading('stomped', 85, 47, { bootCount: 24 }), { ...pending, timestamp: 2050 });
    expect(tracker.snapshot(2100)).toMatchObject({ seenThisSession: false, sessionSteps: 0 });
    expect(tracker.beginSession(3000, { retainStartup: true })).toMatchObject({ sessionSteps: 1, sessionStomps: 1, engaged: true, users: { alex: { steps: 1, stomps: 1 } } });
    tracker.ingest(reading('stomped', 85, 47, { bootCount: 24 }), { timestamp: 3100 });
    tracker.ingest(reading('pressed', 86, 47, { bootCount: 24 }), { timestamp: 3200 });
    expect(tracker.snapshot(3200)).toMatchObject({ sessionSteps: 2, sessionStomps: 1 });
  });

  it.each([false, true])('discards idle or expired candidates without counting a duplicate (expired=%s)', (expired) => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading('pressed', 85, 46), { timestamp: 1000, countSession: false, retainStartup: true });
    tracker.beginSession(expired ? 12000 : 2000, { retainStartup: expired });
    tracker.ingest(reading('pressed', 85, 46), { timestamp: 13000 });
    expect(tracker.snapshot(13000)).toMatchObject({ sessionSteps: 0, seenThisSession: false });
  });

  it('rearming does not count, disengage a used mat, or erase totals', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading('pressed', 1, 0), { timestamp: 1000 });
    tracker.ingest(reading(null, 1, 0, { occupancyKnown: false, detectionState: 'rearmed' }), { timestamp: 7000 });
    expect(tracker.snapshot(7000)).toMatchObject({ sessionSteps: 1, engaged: true, latest: { occupancyKnown: false } });
  });

  it('does not import an unobserved idle gap into startup totals', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading(null, 10, 2), { timestamp: 1000, countSession: false });
    tracker.ingest(reading(null, 50, 20), { timestamp: 20000, countSession: false, retainStartup: true });
    tracker.ingest(reading('pressed', 51, 20), { timestamp: 21000, countSession: false, retainStartup: true });
    expect(tracker.beginSession(22000, { retainStartup: true })).toMatchObject({ sessionSteps: 1, sessionStomps: 0 });
  });

  it('counts a stomp as one step and one stomp without double counting', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading(null, 0, 0), { timestamp: 1_000 });
    tracker.ingest(reading('pressed', 1, 0), { timestamp: 2_000, assignedUserId: 'alex' });
    tracker.ingest(reading('stomped', 1, 1), { timestamp: 2_050, assignedUserId: 'alex' });
    expect(tracker.snapshot(2_050)).toMatchObject({ sessionSteps: 1, sessionStomps: 1, engaged: true });
    expect(tracker.snapshot(2_050).users.alex).toEqual({ steps: 1, stomps: 1 });
  });

  it('recovers missed websocket edges from cumulative readings', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading(null, 10, 2), { timestamp: 1_000 });
    tracker.ingest(reading(null, 13, 3), { timestamp: 2_000, assignedUserId: 'sam' });
    expect(tracker.snapshot(2_000)).toMatchObject({ sessionSteps: 3, sessionStomps: 1 });
    expect(tracker.snapshot(2_000).users.sam).toEqual({ steps: 3, stomps: 1 });
  });

  it('rebases a firmware restart without subtracting or inventing reps', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading(null, 8, 2, { bootCount: 3 }), { timestamp: 1_000 });
    tracker.ingest(reading('pressed', 9, 2, { bootCount: 3 }), { timestamp: 2_000 });
    tracker.ingest(reading(null, 0, 0, { bootCount: 4 }), { timestamp: 3_000 });
    tracker.ingest(reading('pressed', 1, 0, { bootCount: 4 }), { timestamp: 4_000 });
    expect(tracker.snapshot(4_000).sessionSteps).toBe(2);
  });

  it('ages activity and SPM while retaining session totals and engagement', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1', {
      active_timeout_seconds: 10, online_timeout_seconds: 5, spm_window_seconds: 15,
    });
    tracker.ingest(reading(null, 0, 0), { timestamp: 1_000 });
    tracker.ingest(reading('pressed', 1, 0), { timestamp: 2_000 });
    expect(tracker.snapshot(2_000).stepsPerMinute).toBe(4);
    expect(tracker.snapshot(13_000)).toMatchObject({ active: false, online: false, engaged: true, sessionSteps: 1 });
    expect(tracker.snapshot(18_000).stepsPerMinute).toBe(0);
  });

  it('manual disengagement preserves totals', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading('pressed', 1, 0), { timestamp: 1_000 });
    expect(tracker.disengage()).toBe(true);
    expect(tracker.snapshot(1_000)).toMatchObject({ engaged: false, sessionSteps: 1 });
  });

  it('changes rate settings without resetting activity or counter baselines', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading('pressed', 10, 2), { timestamp: 1_000 });
    tracker.configure({ spm_window_seconds: 30 });
    tracker.ingest(reading('pressed', 11, 2), { timestamp: 2_000 });
    expect(tracker.snapshot(2_000)).toMatchObject({ sessionSteps: 2, stepsPerMinute: 4, seenThisSession: true });
  });

  it('restores workout totals but not live rate or firmware counters from before a browser gap', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.restore({ sessionSteps: 40, sessionStomps: 8, users: { alex: { steps: 30, stomps: 4 } } });
    expect(tracker.snapshot(1_000)).toMatchObject({ sessionSteps: 40, seenThisSession: true, online: false, active: false, stepsPerMinute: 0 });
    tracker.ingest(reading(null, 500, 90), { timestamp: 1_000 });
    tracker.ingest(reading('pressed', 501, 90), { timestamp: 2_000, assignedUserId: 'alex' });
    expect(tracker.snapshot(2_000)).toMatchObject({ sessionSteps: 41, sessionStomps: 8, users: { alex: { steps: 31, stomps: 4 } } });
    expect(tracker.checkpoint()).not.toHaveProperty('lastDeviceSteps');
  });

  it('preserves new steps received while an asynchronous resume request was pending', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading('pressed', 101, 8), { timestamp: 1_000, assignedUserId: 'sam' });
    tracker.restore({ sessionSteps: 40, sessionStomps: 8, users: { sam: { steps: 40, stomps: 8 } } }, { preserveLive: true });
    tracker.ingest(reading('pressed', 102, 8), { timestamp: 2_000, assignedUserId: 'sam' });
    expect(tracker.snapshot(2_000)).toMatchObject({ sessionSteps: 42, users: { sam: { steps: 42, stomps: 8 } } });
  });

  it('does not mistake duplicate or same-boot regressing readings for new steps', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    [100, 101, 100, 101].forEach((steps, i) => tracker.ingest(reading('pressed', steps, 2, { bootCount: 3 }), { timestamp: i * 1_000 }));
    expect(tracker.snapshot(4_000).sessionSteps).toBe(2);
  });

  it('ignores delayed frames from a previous boot and stale device timestamps', () => {
    const tracker = new PressureMatActivityTracker('step-mat', 'mat-1');
    tracker.ingest(reading('pressed', 100, 2, { bootCount: 3, deviceTs: 10000 }), { timestamp: 1000 });
    tracker.ingest(reading(null, 0, 0, { bootCount: 4, deviceTs: 10 }), { timestamp: 2000 });
    tracker.ingest(reading('pressed', 101, 2, { bootCount: 3, deviceTs: 10001 }), { timestamp: 3000 });
    tracker.ingest(reading('pressed', 1, 0, { bootCount: 4, deviceTs: 20 }), { timestamp: 4000 });
    tracker.ingest(reading('pressed', 2, 0, { bootCount: 4, deviceTs: 15 }), { timestamp: 5000 });
    expect(tracker.snapshot(5000)).toMatchObject({ sessionSteps: 2, latest: { steps: 1 }, lastSeenAt: 4000 });
  });
});
