import { describe, expect, it } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

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
});
