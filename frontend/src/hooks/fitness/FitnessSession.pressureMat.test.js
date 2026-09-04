import { describe, expect, it } from 'vitest';
import { FitnessSession } from './FitnessSession.js';
import { FitnessTimeline } from './FitnessTimeline.js';

describe('FitnessSession pressure-mat routing', () => {
  it('routes by hardware id and attributes every recovered rep to the assignee at ingest time', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([{
      id: 'step_mat', name: 'Step Mat', type: 'pressure_mat', pressure_mat: 'garage-step-mat',
      activity: { spm_window_seconds: 15 },
    }]);
    session.sessionId = '20260902220000';

    session.setEquipmentUser('step_mat', 'user_1');
    session.ingestPressureMat({
      id: 'garage-step-mat', type: 'presence', event: 'pressed', steps: 1, stomps: 0,
    }, { timestamp: 1_000 });

    session.setEquipmentUser('step_mat', 'user_2');
    session.ingestPressureMat({
      id: 'garage-step-mat', type: 'presence', event: 'stomped', steps: 3, stomps: 1,
    }, { timestamp: 2_000 });

    const snap = session.getPressureMatTracker('step_mat').snapshot(2_000);
    expect(snap.sessionSteps).toBe(3);
    expect(snap.sessionStomps).toBe(1);
    expect(snap.users).toEqual({
      user_1: { steps: 1, stomps: 0 },
      user_2: { steps: 2, stomps: 1 },
    });
    session.destroy();
  });

  it('does not count pre-session relay traffic', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([{ id: 'step_mat', type: 'step_mat', pressure_mat: 'garage-step-mat' }]);
    session.ingestPressureMat({
      id: 'garage-step-mat', type: 'presence', event: 'pressed', steps: 20, stomps: 2,
    }, { timestamp: 1_000 });
    expect(session.getPressureMatTracker('step_mat').snapshot(1_000).seenThisSession).toBe(false);
    session.destroy();
  });

  it('discovers an unconfigured relay mat so its first session step can surface the sidebar card', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([]);
    session.sessionId = '20260903140000';

    const snapshot = session.ingestPressureMat({
      id: 'garage-step-mat', type: 'presence', event: 'pressed', steps: 9, stomps: 7,
    }, { timestamp: 1_000 });

    expect(snapshot).toMatchObject({
      equipmentId: 'garage-step-mat',
      matId: 'garage-step-mat',
      seenThisSession: true,
      engaged: true,
      sessionSteps: 1,
    });
    expect(session.getPressureMatSnapshots(1_000)['garage-step-mat']).toEqual(snapshot);
    session.destroy();
  });

  it('keeps a discovered mat hidden until a session step is classified', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([]);

    const snapshot = session.ingestPressureMat({
      id: 'garage-step-mat', type: 'presence', event: 'pressed', steps: 9, stomps: 7,
    }, { timestamp: 1_000 });

    expect(snapshot.seenThisSession).toBe(false);
    expect(snapshot.sessionSteps).toBe(0);
    session.destroy();
  });

  it('retains the same tracker, counts, visibility, and assignee across identical or missing config', () => {
    const session = new FitnessSession();
    const catalog = [{ id: 'step_mat', type: 'pressure_mat', pressure_mat: 'mat-1' }];
    session.setEquipmentCatalog(catalog);
    session.sessionId = 'fs_20260904144124';
    session.setEquipmentUser('step_mat', 'alex');
    session.ingestPressureMat({ id: 'mat-1', type: 'presence', event: 'pressed', steps: 100, stomps: 8 }, { timestamp: 1000 });
    const tracker = session.getPressureMatTracker('step_mat');
    session.setEquipmentCatalog(catalog.map(item => ({ ...item })));
    session.setEquipmentCatalog([]);
    expect(session.getPressureMatTracker('step_mat')).toBe(tracker);
    session.ingestPressureMat({ id: 'mat-1', type: 'presence', event: 'pressed', steps: 101, stomps: 8 }, { timestamp: 2000 });
    expect(tracker.snapshot(2000)).toMatchObject({ sessionSteps: 2, seenThisSession: true, users: { alex: { steps: 2 } } });
    expect(session.getEquipmentRider('step_mat')).toBe('alex');
    session.destroy();
  });

  it('promotes a discovered mat without splitting its timeline, counts, or assignment', () => {
    const session = new FitnessSession();
    session.sessionId = 'fs_20260904144124';
    session.timeline = new FitnessTimeline(0, 5000);
    session.ingestPressureMat({ id: 'mat-1', type: 'presence', event: 'pressed', steps: 100, stomps: 8 }, { timestamp: 1000 });
    session.setEquipmentUser('mat-1', 'alex');
    session.timeline.series['device:mat-1:steps_total'] = [1];
    session.setEquipmentCatalog([{ id: 'step_mat', type: 'pressure_mat', pressure_mat: 'mat-1' }]);
    expect(Object.keys(session.getPressureMatSnapshots(1000))).toEqual(['step_mat']);
    expect(session.getPressureMatTracker('step_mat').snapshot(1000).sessionSteps).toBe(1);
    expect(session.getEquipmentRider('step_mat')).toBe('alex');
    expect(session.timeline.series['device:step_mat:steps_total']).toEqual([1]);
    expect(session.timeline.series).not.toHaveProperty('device:mat-1:steps_total');
    session.destroy();
  });

  it('restores legacy sampled totals and binds the recorder to the resumed timeline', () => {
    const session = new FitnessSession();
    const now = Date.now();
    session.setEquipmentCatalog([{ id: 'step_mat', type: 'pressure_mat', pressure_mat: 'mat-1' }]);
    session._hydrateFromSession({ sessionId: 'fs_20260904144124', startTime: now - 5000, endTime: now,
      timeline: { tick_count: 1, series: { 'device:step_mat:steps_total': [40], 'device:step_mat:stomps_total': [8], 'user:alex:steps_total': [30] } } });
    expect(session.getPressureMatSnapshots(now).step_mat).toMatchObject({ sessionSteps: 40, seenThisSession: true, stepsPerMinute: 0 });
    expect(session._timelineRecorder._timeline).toBe(session.timeline);
    session.ingestPressureMat({ id: 'mat-1', type: 'presence', event: 'pressed', steps: 101, stomps: 8 }, { timestamp: now + 1000 });
    expect(session.getPressureMatSnapshots(now + 1000).step_mat).toMatchObject({ sessionSteps: 41, sessionStomps: 8, users: { alex: { steps: 30 } } });
    session._timelineRecorder.recordTick({ timestamp: now + 5000, sessionId: session.sessionId });
    expect(session.timeline.series['device:step_mat:steps_total']).toEqual([40, 41]);
    session.destroy();
  });

  it('preserves the complete canonical series when merging a discovered identity', () => {
    const session = new FitnessSession();
    session.timeline = new FitnessTimeline(0, 5000);
    session.timeline.series['device:mat-1:steps_total'] = [1, null];
    session.timeline.series['device:step_mat:steps_total'] = [null, 2, 3];
    session._renamePressureMatSeries('mat-1', 'step_mat');
    expect(session.timeline.series['device:step_mat:steps_total']).toEqual([1, 2, 3]);
    expect(session.timeline.series).not.toHaveProperty('device:mat-1:steps_total');
    session.destroy();
  });

  it('round-trips durable mat identities, assignments, and user totals through session metadata', () => {
    const first = new FitnessSession();
    const now = Date.now();
    first.sessionId = 'fs_20260904144124';
    first.startTime = now - 5000;
    first.setEquipmentUser('mat-1', 'alex');
    first.ingestPressureMat({ id: 'mat-1', type: 'presence', event: 'pressed', steps: 100, stomps: 8 }, { timestamp: now });
    const saved = JSON.parse(JSON.stringify(first.summary));
    const second = new FitnessSession();
    second.setEquipmentCatalog([{ id: 'step_mat', type: 'pressure_mat', pressure_mat: 'mat-1' }]);
    second._hydrateFromSession(saved);
    second.ingestPressureMat({ id: 'mat-1', type: 'presence', event: 'pressed', steps: 101, stomps: 8 }, { timestamp: now + 1000 });
    expect(second.getPressureMatSnapshots(now + 1000).step_mat).toMatchObject({ sessionSteps: 2, users: { alex: { steps: 2 } } });
    expect(second.getEquipmentRider('step_mat')).toBe('alex');
    first.destroy();
    second.destroy();
  });
});
