import { describe, it, expect } from 'vitest';

describe('challenge feasibility check', () => {
  /**
   * Check if a challenge zone is achievable for a set of participants.
   * Mirrors GovernanceEngine._checkChallengeFeasibility logic:
   * - null profile (unresolved user) = NOT achievable
   * - null threshold (zone not in config) = NOT achievable
   * - Only count participants we can positively confirm are within range
   *
   * @param {string} targetZone
   * @param {string} rule - 'all', 'majority', 'any', or a number
   * @param {Array|null[]} participants - [{id, currentHr, zoneThresholds}] or null entries for unresolved
   * @param {number} feasibilityMarginBpm
   * @returns {{feasible: boolean, reason?: string, unresolvedCount?: number}}
   */
  function checkChallengeFeasibility(targetZone, rule, participants, feasibilityMarginBpm = 20) {
    if (!targetZone || !participants?.length) return { feasible: true };

    const targetThresholdKey = targetZone.toLowerCase();
    let achievableCount = 0;
    let unresolvedCount = 0;

    for (const p of participants) {
      // Null profile = user resolution failure — NOT achievable
      if (!p) {
        unresolvedCount++;
        continue;
      }
      const threshold = p.zoneThresholds?.[targetThresholdKey];
      // No threshold for this zone = can't determine — NOT achievable
      if (threshold == null) continue;
      const gap = threshold - (p.currentHr || 0);
      if (gap <= feasibilityMarginBpm) {
        achievableCount++;
      }
    }

    const requiredCount = rule === 'all' ? participants.length
      : rule === 'majority' ? Math.ceil(participants.length * 0.5)
      : rule === 'any' ? 1
      : typeof rule === 'number' ? Math.min(rule, participants.length)
      : participants.length;

    if (achievableCount < requiredCount) {
      return {
        feasible: false,
        unresolvedCount,
        reason: `Only ${achievableCount}/${requiredCount} participants within ${feasibilityMarginBpm} BPM of ${targetZone} zone`
      };
    }
    return { feasible: true };
  }

  it('should reject challenge when participant is 32+ BPM below hot threshold', () => {
    const participants = [
      { id: 'milo',   currentHr: 155, zoneThresholds: { hot: 160 } },
      { id: 'alan',   currentHr: 138, zoneThresholds: { hot: 170 } }, // 32 BPM gap
      { id: 'felix',  currentHr: 150, zoneThresholds: { hot: 160 } },
      { id: 'kckern', currentHr: 160, zoneThresholds: { hot: 155 } },
    ];
    const result = checkChallengeFeasibility('hot', 'all', participants);
    expect(result.feasible).toBe(false);
  });

  it('should accept challenge when all participants are within 20 BPM', () => {
    const participants = [
      { id: 'milo',   currentHr: 155, zoneThresholds: { hot: 160 } },
      { id: 'alan',   currentHr: 155, zoneThresholds: { hot: 170 } },
      { id: 'felix',  currentHr: 150, zoneThresholds: { hot: 160 } },
      { id: 'kckern', currentHr: 160, zoneThresholds: { hot: 155 } },
    ];
    const result = checkChallengeFeasibility('hot', 'all', participants);
    expect(result.feasible).toBe(true);
  });

  it('should accept majority rule when enough participants are close', () => {
    const participants = [
      { id: 'milo',   currentHr: 155, zoneThresholds: { hot: 160 } },
      { id: 'alan',   currentHr: 100, zoneThresholds: { hot: 170 } }, // too far
      { id: 'felix',  currentHr: 150, zoneThresholds: { hot: 160 } },
      { id: 'kckern', currentHr: 160, zoneThresholds: { hot: 155 } },
    ];
    // majority of 4 = 2
    const result = checkChallengeFeasibility('hot', 'majority', participants);
    expect(result.feasible).toBe(true);
  });

  it('should downgrade zone when target is not feasible', () => {
    const participants = [
      { id: 'milo',   currentHr: 130, zoneThresholds: { warm: 120, hot: 160 } },
      { id: 'alan',   currentHr: 125, zoneThresholds: { warm: 120, hot: 170 } },
    ];
    // hot not feasible for all
    const hotResult = checkChallengeFeasibility('hot', 'all', participants);
    expect(hotResult.feasible).toBe(false);
    // warm IS feasible (both already above warm threshold)
    const warmResult = checkChallengeFeasibility('warm', 'all', participants);
    expect(warmResult.feasible).toBe(true);
  });

  it('should treat null profiles (unresolved users) as NOT achievable', () => {
    // Simulates user resolution failure — profile is null
    const participants = [
      null,  // unresolved user
      null,  // unresolved user
      { id: 'kckern', currentHr: 160, zoneThresholds: { hot: 155 } },
    ];
    // Only 1 of 3 achievable, 'all' requires 3
    const result = checkChallengeFeasibility('hot', 'all', participants);
    expect(result.feasible).toBe(false);
    expect(result.unresolvedCount).toBe(2);
  });

  it('should NOT assume achievable when zone config is missing', () => {
    // Profile exists but has no threshold for the target zone
    const participants = [
      { id: 'milo',  currentHr: 110, zoneThresholds: { cool: 80, active: 100 } }, // no 'hot' entry
      { id: 'alan',  currentHr: 110, zoneThresholds: { cool: 80, active: 100 } },
    ];
    const result = checkChallengeFeasibility('hot', 'all', participants);
    expect(result.feasible).toBe(false); // Can't confirm they can reach hot
  });
});
