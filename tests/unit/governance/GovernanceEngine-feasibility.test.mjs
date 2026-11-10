import { describe, it, expect, vi } from 'vitest';

vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }),
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() })
}));

const { GovernanceEngine } = await import("../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js");

function makeEngine({ profiles }) {
  const engine = new GovernanceEngine();
  engine.session = {
    getParticipantProfile: (pid) => profiles[pid],
  };
  return engine;
}

const ZONES = [
  { id: 'cool', min: 80 },
  { id: 'active', min: 120 },
  { id: 'warm', min: 140 },
  { id: 'hot', min: 160 },
  { id: 'fire', min: 175 },
];

describe('_checkChallengeFeasibility', () => {
  // THE behavioral change: 0 within 20 of hot, but ALL within 20 of warm.
  // Pre-fix the recursive downgrade returns suggestedZone:'warm' (a surprise
  // warm challenge). Post-fix we skip entirely because nobody was close to hot.
  it('skips (no suggestedZone) when 0 are close to hot even though warm IS feasible', () => {
    const profiles = {
      u1: { heartRate: 130, zoneConfig: ZONES }, // hot margin 30, warm margin 10
      u2: { heartRate: 125, zoneConfig: ZONES }, // hot margin 35, warm margin 15
      u3: { heartRate: 128, zoneConfig: ZONES }, // hot margin 32, warm margin 12
    };
    const engine = makeEngine({ profiles });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['u1', 'u2', 'u3']);
    expect(r.feasible).toBe(false);
    expect(r.suggestedZone).toBeUndefined();
    expect(r.reason).toMatch(/0\/3 within 20 BPM/);
  });

  // Downgrade preserved when at least one participant IS within striking distance.
  it('still downgrades to warm when 1+ participant is within 20 BPM of hot and warm is feasible', () => {
    const profiles = {
      u1: { heartRate: 145, zoneConfig: ZONES }, // hot margin 15 (close), warm margin -5
      u2: { heartRate: 125, zoneConfig: ZONES }, // hot margin 35, warm margin 15
      u3: { heartRate: 130, zoneConfig: ZONES }, // hot margin 30, warm margin 10
    };
    const engine = makeEngine({ profiles });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['u1', 'u2', 'u3']);
    expect(r.feasible).toBe(false);
    expect(r.suggestedZone).toBe('warm');
  });

  it('returns feasible when all participants are within 20 BPM of the target', () => {
    const profiles = {
      u1: { heartRate: 145, zoneConfig: ZONES },
      u2: { heartRate: 150, zoneConfig: ZONES },
      u3: { heartRate: 155, zoneConfig: ZONES },
    };
    const engine = makeEngine({ profiles });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['u1', 'u2', 'u3']);
    expect(r.feasible).toBe(true);
  });

  it('skips when everyone is far below every zone (no downgrade target either)', () => {
    const profiles = {
      u1: { heartRate: 95, zoneConfig: ZONES },
      u2: { heartRate: 90, zoneConfig: ZONES },
      u3: { heartRate: 92, zoneConfig: ZONES },
    };
    const engine = makeEngine({ profiles });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['u1', 'u2', 'u3']);
    expect(r.feasible).toBe(false);
    expect(r.suggestedZone).toBeUndefined();
  });
});
