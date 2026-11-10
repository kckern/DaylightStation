import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), sampled: vi.fn()
  }),
  getLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), sampled: vi.fn()
  })
}));

const { GovernanceEngine } = await import("../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js");

function createEngine({ participants = [], userZoneMap = {}, grace = 30, now } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster: participants.map(id => ({ id, isActive: true })),
    zoneProfileStore: null,
    snapshot: { zoneConfig }
  };
  const engine = new GovernanceEngine(mockSession, now ? { now } : {});

  // Pass pre-normalized policies as second argument (bypasses _normalizePolicies)
  const policies = [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: {
      active: 'all',
      grace_period_seconds: grace
    },
    challenges: []
  }];

  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: grace,
  }, policies, {});

  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfig.forEach((z, i) => {
    zoneRankMap[z.id] = i;
    zoneInfoMap[z.id] = z;
  });

  return { engine, zoneRankMap, zoneInfoMap };
}

/**
 * Helper to advance engine to 'unlocked' phase by satisfying base requirements
 * and bypassing hysteresis.
 */
function advanceToUnlocked(engine, participants, userZoneMap, zoneRankMap, zoneInfoMap) {
  engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: participants.length });
}

describe('GovernanceEngine — challenge failure lock priority', () => {
  it('should lock when challenge fails even if base requirements ARE satisfied', () => {
    const participants = ['alice', 'bob', 'charlie'];
    const userZoneMap = { alice: 'warm', bob: 'warm', charlie: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Advance to unlocked state
    advanceToUnlocked(engine, participants, userZoneMap, zoneRankMap, zoneInfoMap);
    expect(engine.phase).toBe('unlocked');

    // Simulate a failed challenge (e.g. "all warm" but charlie is only "active")
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'warm',
      requiredCount: 3,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['charlie'], metUsers: ['alice', 'bob'], actualCount: 2 }
    };

    // All participants are in Active zone or above — base requirement satisfied
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // Should be locked — challenge failure locks regardless of base requirements
    expect(engine.phase).toBe('locked');
  });

  it('floor owns the phase when the floor drops in the same evaluate a challenge is seen failed: grace, then lock', () => {
    // Contract since 6bb1f83d42 (floor priority): while a floor is unmet the
    // floor owns the phase and challenges are backgrounded — a challenge
    // "cannot introduce an earlier playback lock" (governance-engine.md,
    // "Floor priority and challenge suspension"). So a failure first observed
    // together with a floor drop gets the floor's grace window, not an instant
    // lock. It must still LOCK when that grace runs out.
    // The other ordering — failure already locked, THEN the floor drops — must
    // stay locked with no fresh grace (2153e4d9e2); that is covered by
    // GovernanceEngine.floorPriority.test.js "a failed-challenge lock stays
    // locked through repeated floor drops".
    let clock = 1_000_000;
    const participants = ['alice', 'bob', 'charlie'];
    const userZoneMap = { alice: 'warm', bob: 'active', charlie: 'cool' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30, now: () => clock });

    // Get to unlocked first with all meeting requirements
    const allActive = { alice: 'warm', bob: 'active', charlie: 'active' };
    advanceToUnlocked(engine, participants, allActive, zoneRankMap, zoneInfoMap);
    expect(engine.phase).toBe('unlocked');

    // Now charlie drops to cool AND challenge fails
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'warm',
      requiredCount: 3,
      startedAt: clock - 60000,
      expiresAt: clock - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['charlie'], metUsers: ['alice', 'bob'], actualCount: 2 }
    };

    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // Floor owns: warning with the base requirement's full grace window
    expect(engine.phase).toBe('warning');
    expect(engine.meta.deadline - clock).toBe(30000);

    // Grace not yet out -> still warning
    clock += 29000;
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });
    expect(engine.phase).toBe('warning');

    // Grace expires with the floor still unmet -> locked
    clock += 1001;
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });
    expect(engine.phase).toBe('locked');
    expect(engine.state.videoLocked).toBe(true);
  });
});
