// Issue 2 — governance must go dormant while suspended (e.g. the CycleGame
// race owns the screen) even though this.media still points at the paused
// governed video. See docs/_wip/audits/2026-06-06-cycle-governance-deadlock-
// and-stale-media-audit.md.
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
    default: {
      name: 'Default',
      base_requirement: [{ active: 'all' }],
      challenges: []
    }
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

describe('GovernanceEngine — suspend switch', () => {
  it('engages governance (phase unlocked) when NOT suspended and base-req is met', () => {
    const { engine, advance } = makeEngine();
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe('unlocked');
  });

  it('stays dormant (phase null) while suspended, even with governed media + satisfied base-req', () => {
    const { engine, advance } = makeEngine();
    engine.setSuspended(true);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe(null);
    expect(engine.challengeState.activeChallenge).toBe(null);
  });

  it('re-engages after the race ends (setSuspended(false))', () => {
    const { engine, advance } = makeEngine();
    engine.setSuspended(true);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe(null);

    engine.setSuspended(false);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe('unlocked');
  });

  it('does not drop this.media while suspended', () => {
    const { engine, advance } = makeEngine();
    engine.setSuspended(true);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.media).toEqual({ id: 'v1', type: 'episode', labels: ['cardio'] });
  });
});
