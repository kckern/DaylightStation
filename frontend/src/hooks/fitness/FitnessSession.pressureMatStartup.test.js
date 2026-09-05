import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));
import { FitnessSession } from './FitnessSession.js';

describe('FitnessSession pressure mat during HR startup', () => {
  let session;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T23:00:00Z'));
    session = new FitnessSession();
    session.setEquipmentCatalog([{ id: 'step_mat', type: 'pressure_mat', pressure_mat: 'mat-1' }]);
    session.userManager.registerUser({ id: 'alex', name: 'Alex', hr_device_id: 'hr-1' });
  });
  afterEach(() => { session.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); });

  const hr = () => {
    for (let i = 0; i < 10; i++) session.ingestData({ deviceId: 'hr-1', profile: 'HR', data: { ComputedHeartRate: 120 } });
  };
  const mat = (event, steps = 85, stomps = 46) => session.ingestPressureMat({
    id: 'mat-1', type: event ? 'presence' : 'reading', event, steps, stomps, bootCount: 24,
  });
  const snapshot = () => session.getPressureMatTracker('step_mat').snapshot();

  it('keeps the first step/stomp through the actual asynchronous HR/content start path, exactly once', async () => {
    mat(null, 84, 46);
    hr();
    expect(session.sessionId).toBeFalsy();
    mat('pressed');
    mat('stomped', 85, 47);
    expect(snapshot()).toMatchObject({ seenThisSession: false, sessionSteps: 0 });
    vi.advanceTimersByTime(6500);
    hr();
    for (let i = 0; i < 50 && !session.sessionId; i++) await Promise.resolve();
    expect(session.sessionId).toBeTruthy();
    expect(snapshot()).toMatchObject({ seenThisSession: true, engaged: true, sessionSteps: 1, sessionStomps: 1 });
    mat('stomped', 85, 47); // replay of last device message
    mat('pressed', 86, 47);
    expect(snapshot()).toMatchObject({ sessionSteps: 2, sessionStomps: 1 });
  });

  it('mat-only handling cannot start a workout or enter its later totals', () => {
    mat('pressed');
    expect(session.sessionId).toBeFalsy();
    expect(snapshot().seenThisSession).toBe(false);
    session.ensureStarted({ force: true, reason: 'test' });
    mat('pressed'); // unchanged boot counter must not become a step
    expect(snapshot()).toMatchObject({ sessionSteps: 0, seenThisSession: false });
    mat('pressed', 86);
    expect(snapshot().sessionSteps).toBe(1);
  });

  it('does not carry abandoned startup candidates into a later session', () => {
    hr();
    mat('pressed');
    vi.advanceTimersByTime(11000);
    session.ensureStarted({ force: true, reason: 'test' });
    expect(snapshot()).toMatchObject({ sessionSteps: 0, seenThisSession: false });
  });
});
