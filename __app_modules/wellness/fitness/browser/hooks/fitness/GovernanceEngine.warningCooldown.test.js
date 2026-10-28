import { describe, it, expect, vi, beforeEach } from 'vitest';

const { info } = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from "./GovernanceEngine.js";

const zoneRankMap = { cool: 0, active: 1 };
const zoneInfoMap = {
  cool: { id: 'cool', name: 'Cool', color: '#0000ff' },
  active: { id: 'active', name: 'Active', color: '#ff0000' }
};

// Configured engine on an injected clock; evaluate(aliceZone) drives one tick.
function buildEngine() {
  const clock = { t: 1000000 };
  const engine = new GovernanceEngine(
    { roster: [], zoneProfileStore: null, snapshot: { zoneConfig: Object.values(zoneInfoMap) } },
    { now: () => clock.t }
  );
  engine.configure(
    { governed_labels: ['exercise'], grace_period_seconds: 30, warning_cooldown_seconds: 30 },
    [{ id: 'default', name: 'default', minParticipants: 1, baseRequirement: { active: 'all' }, challenges: [] }],
    {}
  );
  engine.setMedia({ id: 'test-media', labels: ['exercise'] });
  engine.setCallbacks({ onPhaseChange: () => {}, onPulse: () => {}, onStateChange: () => {} });
  const evaluate = (aliceZone) => engine.evaluate({
    activeParticipants: ['alice'],
    userZoneMap: { alice: aliceZone },
    zoneRankMap,
    zoneInfoMap,
    totalCount: 1
  });
  return { engine, clock, evaluate };
}

const suppressed = () => info.mock.calls.filter(([name]) => name === 'governance.warning_suppressed');

describe('GovernanceEngine — warning cooldown suppression logging', () => {
  beforeEach(() => info.mockClear());

  it('logs governance.warning_suppressed once per cooldown episode', () => {
    const { engine, clock, evaluate } = buildEngine();
    try {
      evaluate('active');
      clock.t += 1000; evaluate('cool');
      expect(engine.phase).toBe('warning');
      clock.t += 1000; evaluate('active');
      expect(engine.phase).toBe('unlocked');

      clock.t += 1000; evaluate('cool');
      clock.t += 1000; evaluate('cool');
      expect(engine.phase).toBe('unlocked');
      expect(suppressed()).toHaveLength(1);
      const [, payload] = suppressed()[0];
      expect(payload.contentId).toBe('test-media');
      expect(payload.missingUsers).toEqual(['alice']);
      expect(payload.cooldownRemainingMs).toBeGreaterThan(0);

      // Recovery then a fresh dip, still inside the cooldown -> a new episode.
      clock.t += 1000; evaluate('active');
      clock.t += 1000; evaluate('cool');
      expect(engine.phase).toBe('unlocked');
      expect(suppressed()).toHaveLength(2);
    } finally {
      engine.destroy();
    }
  });
});
