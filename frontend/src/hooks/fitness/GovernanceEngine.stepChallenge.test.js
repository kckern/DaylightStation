import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from './GovernanceEngine.js';

const zones = {
  zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
  zoneInfoMap: {
    active: { id: 'active', name: 'Active', color: 'green', rings: 1 },
    warm: { id: 'warm', name: 'Warm', color: 'yellow', rings: 2 },
  },
};

const challengeConfig = {
  governed_labels: ['cardio'],
  grace_period_seconds: 30,
  policies: {
    default: {
      base_requirement: [{ active: 'all' }],
      challenges: [{
        interval: [1, 1],
        min_participants: 0,
        selections: [{
          type: 'step', equipment: 'step_mat', metric: 'steps', target: 40,
          time_allowed: 60, sensor_grace_seconds: 10, reward_multiplier: 1.5,
        }],
      }],
    },
  },
};

const activity = (overrides = {}) => ({
  online: true,
  active: true,
  engaged: true,
  sessionSteps: 10,
  sessionStomps: 2,
  stepsPerMinute: 36,
  ...overrides,
});

function makeHarness(config = challengeConfig) {
  let now = 100_000;
  let currentMat = activity();
  const awardBonus = vi.fn(() => ({ awarded: true, rings: 3 }));
  const logEvent = vi.fn();
  const session = {
    treasureBox: { awardBonus },
    logEvent,
    getVibrationTracker: () => null,
    getPressureMatSnapshots: () => ({ step_mat: currentMat }),
    getActiveParticipantState: () => ({
      participants: ['user_1', 'user_2'], zoneMap: { user_1: 'warm', user_2: 'warm' }, totalCount: 2, guestIds: [], hrInactiveUsers: [],
    }),
  };
  const engine = new GovernanceEngine(session, { now: () => now, random: () => 0 });
  engine.configure(config);
  engine.setMedia({ id: 'workout', labels: ['cardio'] });

  const evaluate = ({ mat = activity(), rider = 'user_1', userZone = 'warm' } = {}) => {
    currentMat = mat;
    return engine.evaluate({
      activeParticipants: ['user_1', 'user_2'],
      userZoneMap: { user_1: userZone, user_2: userZone },
      totalCount: 2,
      ...zones,
      equipmentRiderMap: rider ? { step_mat: rider } : {},
      activityMetricMap: { step_mat: mat },
    });
  };

  return {
    engine,
    awardBonus,
    logEvent,
    evaluate,
    setMat(mat) { currentMat = mat; },
    advance(ms) { now += ms; return now; },
    cleanup() { engine.reset(); },
  };
}

const harnesses = [];
afterEach(() => {
  while (harnesses.length) harnesses.pop().cleanup();
});

describe('GovernanceEngine step/stomp challenges', () => {
  it('only schedules the challenge while its mat is online and recently active', () => {
    const h = makeHarness(); harnesses.push(h);
    h.evaluate({ mat: activity({ active: false }) });
    expect(h.engine.state.nextChallenge).toBeNull();

    h.evaluate();
    expect(h.engine.state.nextChallenge?.type).toBe('step');
    expect(h.engine.state.nextChallenge?.requiredCount).toBe(40);
  });

  it('counts from the start baseline and awards completion-zone rings to the current assignee once', () => {
    const h = makeHarness(); harnesses.push(h);
    h.evaluate();
    h.advance(1000);
    h.evaluate();
    expect(h.engine.state.challenge).toEqual(expect.objectContaining({ type: 'step', startCount: 10, actualCount: null }));

    h.advance(100);
    h.evaluate({ mat: activity({ sessionSteps: 49 }), rider: 'user_1' });
    expect(h.engine.state.challenge.actualCount).toBe(39);

    // Attribution is intentionally resolved at completion, not at challenge start.
    h.advance(100);
    h.evaluate({ mat: activity({ sessionSteps: 50 }), rider: 'user_2' });
    expect(h.engine.state.challenge.status).toBe('success');
    expect(h.engine.state.challenge.assignedUserId).toBe('user_2');
    expect(h.awardBonus).toHaveBeenCalledOnce();
    expect(h.awardBonus).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_2', rings: 3, zoneId: 'warm', source: 'step_challenge',
    }));

    h.evaluate({ mat: activity({ sessionSteps: 51 }), rider: 'user_2' });
    expect(h.awardBonus).toHaveBeenCalledOnce();
  });

  it('pauses without penalty and cancels/requeues after the sensor grace window', () => {
    const h = makeHarness(); harnesses.push(h);
    h.evaluate();
    h.advance(1000); h.evaluate();
    const challengeId = h.engine.state.challenge.id;

    h.advance(100); h.evaluate({ mat: activity({ online: false }) });
    expect(h.engine.state.challenge.id).toBe(challengeId);
    expect(h.engine.state.videoLocked).toBe(false);

    h.advance(10_000); h.evaluate({ mat: activity({ online: false }) });
    expect(h.engine.state.challenge).toBeNull();
    expect(h.engine.challengeState.challengeHistory.at(-1)).toEqual(expect.objectContaining({
      id: challengeId, status: 'cancelled', cancelReason: 'sensor_offline',
    }));
    expect(h.logEvent).toHaveBeenCalledWith(
      'challenge_cancelled',
      expect.objectContaining({ challengeId }),
      expect.any(Number)
    );
  });

  it('refreshes mat liveness from the session on timer-driven evaluations', () => {
    const h = makeHarness(); harnesses.push(h);
    h.evaluate();
    h.advance(1000); h.evaluate();
    expect(h.engine.state.challenge?.type).toBe('step');

    h.setMat(activity({ online: false }));
    h.advance(100); h.engine.evaluate();
    expect(h.engine.state.challenge?.sensorOnline).toBe(false);
    expect(h.engine.state.videoLocked).toBe(false);
  });

  it('removes a failed challenge lock while its sensor is unavailable', () => {
    const h = makeHarness(); harnesses.push(h);
    h.evaluate();
    h.advance(1000); h.evaluate();
    h.advance(60_001); h.evaluate();
    expect(h.engine.state.challenge?.status).toBe('failed');
    expect(h.engine.state.videoLocked).toBe(true);

    h.advance(100); h.evaluate({ mat: activity({ online: false }) });
    expect(h.engine.state.challenge?.status).toBe('failed');
    expect(h.engine.phase).toBe('unlocked');
    expect(h.engine.state.videoLocked).toBe(false);
  });
});

describe('GovernanceEngine activity-rate requirement', () => {
  const config = {
    governed_labels: ['cardio'],
    grace_period_seconds: 30,
    policies: {
      default: {
        requirements: [{
          id: 'keep-stepping', type: 'activity_rate', equipment: 'step_mat',
          metric: 'steps_per_minute', minimum: 30, window_seconds: 15,
          engage_on: 'first_step', offline_policy: 'suspend', enabled: true,
        }],
        challenges: [],
      },
    },
  };

  it('latches after engagement, uses ordinary grace, locks, recovers, and fails open offline', () => {
    const h = makeHarness(config); harnesses.push(h);
    h.evaluate({ mat: activity({ stepsPerMinute: 4 }) });
    expect(h.engine.phase).toBe('warning');
    expect(h.engine.state.requirements[0]).toEqual(expect.objectContaining({
      type: 'activity_rate', currentRate: 4, targetRate: 30, satisfied: false,
    }));

    h.advance(29_000); h.evaluate({ mat: activity({ stepsPerMinute: 4 }) });
    expect(h.engine.phase).toBe('warning');
    h.advance(2_000); h.evaluate({ mat: activity({ stepsPerMinute: 4 }) });
    expect(h.engine.phase).toBe('locked');

    h.evaluate({ mat: activity({ stepsPerMinute: 32 }) });
    expect(h.engine.phase).toBe('unlocked');

    h.evaluate({ mat: activity({ online: false, stepsPerMinute: 0 }) });
    expect(h.engine.phase).toBe('unlocked');
    expect(h.engine.state.requirements[0].suspended).toBe(true);

    h.evaluate({ mat: activity({ engaged: false, active: false, stepsPerMinute: 0 }) });
    expect(h.engine.phase).toBe('unlocked');
    expect(h.engine.state.requirements).toEqual([]);
  });
});
