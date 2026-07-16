/**
 * Regression — effort REPLACES duration as the absorb gate on the series path.
 *
 * Variant-1 data-loss shape (the bug this guards against):
 *   - A LONG, insignificant ghost segment (near-zero effort) on a device,
 *   - immediately followed by a SHORT segment with SIGNIFICANT effort
 *     (40 coins) by a DIFFERENT occupant.
 *
 * Under the OLD design the series path ran BOTH the legacy duration rules
 * (`applyAbsorbRules`) AND the effort pass:
 *   - `applyAbsorbRules` saw the short real segment as sub-threshold with no
 *     successor → OI-1 backward absorb {real → ghost}.
 *   - `applyEffortAbsorb` saw the insignificant long ghost → forward absorb
 *     {ghost → real}.
 * The two reciprocal transfers landed BOTH occupants in `removedOccupants`
 * and the real occupant's data was LOST.
 *
 * Under the NEW design effort is the sole gate: the insignificant ghost folds
 * forward into the real occupant, the brief-but-REAL burst is KEPT, and there
 * is exactly one transfer (no reciprocal, no data loss). This mirrors the
 * backend SessionIdentityHealer (effort-only).
 */
import { describe, it, expect } from 'vitest';
import { runSessionBackfill } from './sessionBackfill.js';

describe('runSessionBackfill — effort replaces duration (Variant-1 data-loss guard)', () => {
  it('keeps a short but SIGNIFICANT-effort burst and absorbs only the long insignificant ghost', () => {
    const T = 5 * 60 * 1000; // 5-min threshold — makes the real burst "sub-T"

    const entities = [
      // Long ghost segment (10 min) — over threshold, but near-zero effort.
      { entityId: 'g1', profileId: 'ghostrider', deviceId: 'D1', startTime: 0,      endTime: 600000, status: 'active' },
      // Short REAL burst (30 s) — sub-threshold by DURATION, but 40 coins of
      // real effort. The OLD duration rule absorbed this backward into the
      // ghost, losing the data.
      { entityId: 'r1', profileId: 'realrider', deviceId: 'D1', startTime: 600000, endTime: 630000, status: 'active' }
    ];
    const series = {
      // Ghost: 1 HR sample, no coins → insignificant effort.
      'user:ghostrider:heart_rate': [116, null, null, null],
      // Real rider: significant effort via coins (40), a couple HR samples.
      'user:realrider:heart_rate':  [null, null, 130, 131],
      'user:realrider:coins_total': [null, null, 20, 40]
    };

    const r = runSessionBackfill({ entities, series, thresholdMs: T, sessionEndTime: 630000 });

    // The real burst is KEPT (brief-but-real → not absorbed).
    expect(r.keptOccupants.has('realrider')).toBe(true);
    expect([...r.removedOccupants]).not.toContain('realrider');

    // The insignificant ghost is absorbed forward INTO the real occupant.
    expect([...r.removedOccupants]).toContain('ghostrider');
    expect(r.transfers.some(t => t.fromOccupantId === 'ghostrider' && t.toOccupantId === 'realrider')).toBe(true);

    // No reciprocal transfer — the real occupant is never a transfer SOURCE,
    // so its data is not moved onto the ghost and then lost.
    expect(r.transfers.some(t => t.fromOccupantId === 'realrider')).toBe(false);
  });
});
