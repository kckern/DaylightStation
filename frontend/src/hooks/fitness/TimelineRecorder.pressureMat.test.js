import { describe, expect, it, vi } from 'vitest';
import { FitnessTimeline } from './FitnessTimeline.js';
import { PressureMatActivityTracker } from './PressureMatActivityTracker.js';
import { TimelineRecorder } from './TimelineRecorder.js';

describe('TimelineRecorder pressure-mat observability', () => {
  it('sums user attribution across mats rather than keeping only the last mat', () => {
    const first = new PressureMatActivityTracker('first', 'mat-1');
    const second = new PressureMatActivityTracker('second', 'mat-2');
    first.restore({ sessionSteps: 5, sessionStomps: 1, users: { alex: { steps: 5, stomps: 1 } } });
    second.restore({ sessionSteps: 7, sessionStomps: 2, users: { alex: { steps: 7, stomps: 2 } } });
    const timeline = new FitnessTimeline(0, 5000);
    const recorder = new TimelineRecorder({ intervalMs: 5000 });
    recorder.configure({ deviceManager: { getAllDevices: () => [] }, userManager: {}, timeline,
      activityMonitor: { getPreviousTickActive: () => new Set(), recordTick: vi.fn() }, eventJournal: { log: vi.fn() } });
    recorder.setPressureMatTrackers(new Map([['first', first], ['second', second]]));
    recorder.recordTick({ timestamp: 5000, sessionId: 'session-1' });
    expect(timeline.series['user:alex:steps_total']).toEqual([12]);
    expect(timeline.series['user:alex:stomps_total']).toEqual([3]);
    expect(timeline.series['device:first:steps_total']).toEqual([5]);
    expect(timeline.series['device:second:steps_total']).toEqual([7]);
  });

  it('samples canonical totals/SPM and per-user totals without raw edge events', () => {
    const timestamp = 20_000;
    const tracker = new PressureMatActivityTracker('step_mat', 'garage-step-mat', { spm_window_seconds: 15 });
    tracker.ingest({
      id: 'garage-step-mat', type: 'presence', event: 'pressed', steps: 1, stomps: 0,
    }, { timestamp: 10_000, assignedUserId: 'user_1' });
    tracker.ingest({
      id: 'garage-step-mat', type: 'presence', event: 'stomped', steps: 3, stomps: 1,
    }, { timestamp: 15_000, assignedUserId: 'user_2' });

    const timeline = new FitnessTimeline(0, 5_000);
    const recorder = new TimelineRecorder({ intervalMs: 5_000 });
    recorder.configure({
      deviceManager: { getAllDevices: () => [] },
      userManager: {},
      timeline,
      activityMonitor: { getPreviousTickActive: () => new Set(), recordTick: vi.fn() },
      eventJournal: { log: vi.fn() },
    });
    recorder.setPressureMatTrackers(new Map([['step_mat', tracker]]));
    recorder.recordTick({ timestamp, sessionId: 'session-1' });

    expect(timeline.series['device:step_mat:steps_total']).toEqual([3]);
    expect(timeline.series['device:step_mat:stomps_total']).toEqual([1]);
    expect(timeline.series['device:step_mat:steps_per_minute']).toEqual([12]);
    expect(timeline.series['user:user_1:steps_total']).toEqual([1]);
    expect(timeline.series['user:user_2:steps_total']).toEqual([2]);
    expect(timeline.events).toEqual([]);
    expect(Object.keys(timeline.series).some((key) => key.startsWith('pressure-mat:'))).toBe(false);
  });
});
