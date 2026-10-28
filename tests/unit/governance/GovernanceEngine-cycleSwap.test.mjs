import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }),
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() })
}));
const { GovernanceEngine } = await import("../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js");

describe('GovernanceEngine.swapCycleRider', () => {
  let engine, nowValue;
  beforeEach(() => {
    nowValue = 10000;
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['user_2', 'user_3', 'user_1'] }]
      }
    };
    engine = new GovernanceEngine(session, { now: () => nowValue });
    // Set up a fake active cycle challenge in init state
    engine.challengeState.activeChallenge = {
      id: 'cyc_1', type: 'cycle', cycleState: 'init', rider: 'user_2',
      ridersUsed: ['user_2'], equipment: 'cycle_ace', currentPhaseIndex: 0,
      initStartedAt: 10000, initElapsedMs: 3000, initTotalMs: 60000,
      rampElapsedMs: 0, phaseProgressMs: 0,
      generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 30 }],
      selection: { init: { minRpm: 30, timeAllowedSeconds: 60 } }
    };
  });

  it('swap during init succeeds — rider changes, init timer resets', () => {
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(true);
    const active = engine.challengeState.activeChallenge;
    expect(active.rider).toBe('user_3');
    expect(active.ridersUsed).toEqual(['user_2', 'user_3']);
    expect(active.initElapsedMs).toBe(0);
    expect(active.cycleState).toBe('init');
  });

  it('swap during phase-1 ramp succeeds — reverts to init for new rider', () => {
    engine.challengeState.activeChallenge.cycleState = 'ramp';
    engine.challengeState.activeChallenge.rampElapsedMs = 5000;
    engine.challengeState.activeChallenge.currentPhaseIndex = 0;
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(true);
    const active = engine.challengeState.activeChallenge;
    expect(active.cycleState).toBe('init');
    expect(active.rampElapsedMs).toBe(0);
    expect(active.phaseProgressMs).toBe(0);
  });

  // Tag-team rule (5f2b531ade, see _isCycleSwapAllowed): a swap is allowed in
  // any NON-TERMINAL cycle state — maintain, a later phase's ramp, and locked
  // included — so a tired rider can hand off mid-challenge. Only terminal
  // statuses (success/failed) reject. Every accepted swap restarts init.
  it('swap during maintain succeeds (tag-team) — reverts to init for new rider', () => {
    engine.challengeState.activeChallenge.cycleState = 'maintain';
    engine.challengeState.activeChallenge.phaseProgressMs = 12000;
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(true);
    const active = engine.challengeState.activeChallenge;
    expect(active.rider).toBe('user_3');
    expect(active.cycleState).toBe('init');
    expect(active.phaseProgressMs).toBe(0);
  });

  it('swap during phase-2 ramp succeeds (tag-team)', () => {
    engine.challengeState.activeChallenge.cycleState = 'ramp';
    engine.challengeState.activeChallenge.currentPhaseIndex = 1;
    engine.challengeState.activeChallenge.rampElapsedMs = 4000;
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(true);
    const active = engine.challengeState.activeChallenge;
    expect(active.cycleState).toBe('init');
    expect(active.rampElapsedMs).toBe(0);
  });

  it('swap during locked succeeds — a teammate can take over a health-locked challenge', () => {
    engine.challengeState.activeChallenge.cycleState = 'locked';
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(true);
    expect(engine.challengeState.activeChallenge.rider).toBe('user_3');
    expect(engine.challengeState.activeChallenge.cycleState).toBe('init');
  });

  it('swap rejected once the challenge is terminal (success)', () => {
    const active = engine.challengeState.activeChallenge;
    active.status = 'success';
    active.cycleState = 'success';
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/terminal/i);
    expect(active.rider).toBe('user_2');
  });

  it('swap to non-eligible user rejected', () => {
    const result = engine.swapCycleRider('eve');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/eligible/i);
  });

  it('swap to cooldown user rejected unless force:true', () => {
    engine._cycleCooldowns = { user_3: nowValue + 10000 };
    expect(engine.swapCycleRider('user_3').success).toBe(false);
    expect(engine.swapCycleRider('user_3').reason).toMatch(/cooldown/i);
    expect(engine.swapCycleRider('user_3', { force: true }).success).toBe(true);
  });

  it('rejects when no active cycle challenge', () => {
    engine.challengeState.activeChallenge = null;
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/no active/i);
  });

  it('rejects when active challenge is not cycle type', () => {
    engine.challengeState.activeChallenge = { type: 'zone' };
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(false);
  });

  // A finished challenge keeps cycleState 'maintain' and flips only `status`
  // to 'success' for the ~600ms success hold (CYCLE_SUCCESS_PUBLISH_MS). A swap
  // in that window must not drag it back to init.
  it.each(['success', 'failed', 'cancelled'])('rejects a swap once status is %s, even with cycleState still maintain', (status) => {
    const active = engine.challengeState.activeChallenge;
    active.cycleState = 'maintain';
    active.status = status;
    active.phaseProgressMs = 30000;
    const result = engine.swapCycleRider('user_3');
    expect(result.success).toBe(false);
    expect(active.rider).toBe('user_2');
    expect(active.cycleState).toBe('maintain');
    expect(active.phaseProgressMs).toBe(30000);
  });
});
