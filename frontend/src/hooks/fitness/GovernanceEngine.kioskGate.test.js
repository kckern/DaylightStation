// Governance is kiosk-bound: off-kiosk (dev/test) the engine must never lock
// content — it stays idle so a developer is never gated. Mirrors the suspend
// switch (GovernanceEngine.suspend.test.js).
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

function buildSession() {
  return {
    _deviceRouter: { getEquipmentCatalog: () => [] },
    getParticipantProfile: () => null,
    zoneProfileStore: null,
    getActiveParticipantState: () => ({
      participants: ['felix'],
      zoneMap: { felix: 'active' },
      totalCount: 1
    })
  };
}

const POLICY = {
  governed_labels: ['cardio'],
  grace_period_seconds: 30,
  policies: {
    default: { name: 'Default', base_requirement: [{ active: 'all' }], challenges: [] }
  }
};

function makeEngine() {
  let now = 100000;
  const engine = new GovernanceEngine(buildSession(), { now: () => now });
  engine.configure(POLICY);
  engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
  return { engine, advance: (d) => { now += d; return now; } };
}

const EVAL_ARGS = {
  activeParticipants: ['felix'],
  userZoneMap: { felix: 'active' },
  zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
  zoneInfoMap: { active: { id: 'active', name: 'Active' } },
  totalCount: 1
};

describe('GovernanceEngine — kiosk gate', () => {
  it('governs by default (engine enabled in isolation)', () => {
    const { engine, advance } = makeEngine();
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe('unlocked');
  });

  it('stays idle (phase null) when governance is disabled off-kiosk', () => {
    const { engine, advance } = makeEngine();
    engine.setGovernanceEnabled(false);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe(null);
    expect(engine.challengeState.activeChallenge).toBe(null);
  });

  it('does not drop this.media while disabled', () => {
    const { engine, advance } = makeEngine();
    engine.setGovernanceEnabled(false);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.media).toEqual({ id: 'v1', type: 'episode', labels: ['cardio'] });
  });

  it('re-engages when governance is re-enabled (back on kiosk)', () => {
    const { engine, advance } = makeEngine();
    engine.setGovernanceEnabled(false);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe(null);

    engine.setGovernanceEnabled(true);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe('unlocked');
  });
});
