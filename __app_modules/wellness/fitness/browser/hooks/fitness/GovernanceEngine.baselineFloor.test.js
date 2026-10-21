/**
 * A challenge at or below the policy's baseline zone is no challenge: the
 * baseline already holds everyone there to keep the video playing.
 * 2026-10-09 Game Cycling: "all warm" was downgraded to active and recorded
 * as won 125ms after it started, with all four riders already active.
 */
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from "./GovernanceEngine.js";

const ZONE_IDS = ['cool', 'active', 'warm', 'hot', 'fire'];
const ZONE_CONFIG = [
  { id: 'cool', min: 80 },
  { id: 'active', min: 100 },
  { id: 'warm', min: 120 },
  { id: 'hot', min: 140 },
  { id: 'fire', min: 160 },
];

function engineWith(profiles) {
  const engine = new GovernanceEngine({
    getParticipantProfile: (pid) => profiles[pid] || null,
  });
  engine.configure({
    policies: {
      default: {
        base_requirement: [{ active: 'all' }],
        requirements: [{ type: 'zone', zone: 'active', rule: 'all' }],
        challenges: [],
      },
    },
    zoneConfig: ZONE_IDS.map((id) => ({ id, name: id })),
  });
  return engine;
}

const hr = (heartRate) => ({ heartRate, zoneConfig: ZONE_CONFIG });

describe('GovernanceEngine — challenge baseline floor', () => {
  it('ranks zones against the configured baseline', () => {
    const engine = engineWith({});
    expect(engine._isAboveBaselineZone('cool')).toBe(false);
    expect(engine._isAboveBaselineZone('active')).toBe(false);
    expect(engine._isAboveBaselineZone('warm')).toBe(true);
    expect(engine._isAboveBaselineZone('hot')).toBe(true);
  });

  it('skips a warm challenge instead of downgrading it onto the active baseline', () => {
    const engine = engineWith({ a: hr(105), b: hr(85), c: hr(86) });
    const r = engine._checkChallengeFeasibility('warm', 'all', ['a', 'b', 'c']);
    expect(r.feasible).toBe(false);
    expect(r.suggestedZone).toBeUndefined();
    expect(r.reason).toMatch(/baseline/);
  });

  it('still downgrades hot to warm, which is above the baseline', () => {
    const engine = engineWith({ a: hr(125), b: hr(105), c: hr(110) });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['a', 'b', 'c']);
    expect(r.suggestedZone).toBe('warm');
  });

  it('treats every zone as a challenge when no policy is configured', () => {
    const engine = new GovernanceEngine();
    expect(engine._isAboveBaselineZone('active')).toBe(true);
  });
});
