import { describe, it, expect } from 'vitest';
import { validateZoneLadder, buildZoneConfig, MIN_COOL_BASELINE } from './types.js';

/**
 * The false "ON FIRE" celebration, 2026-09-16.
 *
 * A rider holding a steady 132-134bpm against a warm threshold of 140 was
 * celebrated for reaching Fire, then dropped back to active 2.9s later. The
 * cause: buildZoneConfig resolved an unresolvable threshold to 0, which is
 * finite — so every Number.isFinite guard downstream accepted it, and a rung at
 * 0 is enterable by any rider with a pulse. The zone climb then ran to the top.
 *
 * Design: docs/_wip/plans/2026-09-16-zone-ladder-validation-design.md
 */

const ladder = (...mins) => {
  const ids = ['cool', 'active', 'warm', 'hot', 'fire'];
  return mins.map((min, i) => ({ id: ids[i], name: ids[i], min }));
};

describe('validateZoneLadder', () => {
  it('accepts a well-formed five-rung ladder', () => {
    expect(validateZoneLadder(ladder(60, 100, 140, 160, 175)).valid).toBe(true);
  });

  it('accepts a shorter ladder that still climbs', () => {
    expect(validateZoneLadder(ladder(60, 100, 140, 160)).valid).toBe(true);
  });

  it('rejects the all-zero ladder that caused the incident', () => {
    const verdict = validateZoneLadder(ladder(0, 0, 0, 0, 0));
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('below-baseline');
  });

  it('rejects a single sunken rung that a sort-only check would pass', () => {
    // [cool:60, warm:0, hot:160] sorts into [0, 60, 160] — strictly increasing,
    // and structurally fine. The warm rung at 0 is still enterable by everyone.
    // This case is the entire reason validation follows canonical zone order.
    const sunken = [
      { id: 'cool', min: 60 },
      { id: 'warm', min: 0 },
      { id: 'hot', min: 160 }
    ];
    const sortedIsIncreasing = sunken
      .map((z) => z.min).sort((a, b) => a - b)
      .every((min, i, all) => i === 0 || min > all[i - 1]);
    expect(sortedIsIncreasing).toBe(true);

    const verdict = validateZoneLadder(sunken);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('below-baseline');
    expect(verdict.detail.zone).toBe('warm');
  });

  it('rejects a ladder that does not climb in canonical order', () => {
    // warm below active: sortable, but the intensity order is inverted.
    const verdict = validateZoneLadder(ladder(60, 100, 90, 160, 175));
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('not-increasing');
    expect(verdict.detail.zone).toBe('warm');
  });

  it('rejects a missing threshold', () => {
    const verdict = validateZoneLadder([
      { id: 'cool', min: 60 },
      { id: 'active', min: 100 },
      { id: 'warm' }
    ]);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('missing-threshold');
  });

  it('rejects a ladder with fewer than two rungs', () => {
    expect(validateZoneLadder([{ id: 'cool', min: 60 }]).reason).toBe('too-few-rungs');
    expect(validateZoneLadder([]).reason).toBe('too-few-rungs');
    expect(validateZoneLadder(null).reason).toBe('too-few-rungs');
  });

  it('allows a low BOTTOM rung — everyone is at least cool', () => {
    // The floor guards the rungs a rider has to EARN. The bottom rung is not one
    // of them, and the classifier already anchors it at the cool baseline.
    expect(validateZoneLadder(ladder(0, 120, 140, 160)).valid).toBe(true);
  });
});

describe('buildZoneConfig — never fabricates a threshold', () => {
  const GLOBAL = [
    { id: 'cool', name: 'Cool', min: 60 },
    { id: 'active', name: 'Active', min: 100 },
    { id: 'warm', name: 'Warm', min: 120 },
    { id: 'hot', name: 'Hot', min: 140 },
    { id: 'fire', name: 'On Fire', min: 160 }
  ];

  it('produces a ladder that passes validation', () => {
    expect(validateZoneLadder(buildZoneConfig(GLOBAL, null)).valid).toBe(true);
    expect(validateZoneLadder(buildZoneConfig(GLOBAL, { active: 95, warm: 130 })).valid).toBe(true);
  });

  it('drops an unknown zone rather than handing it a 0 threshold', () => {
    // An id absent from the defaults has nothing to resolve against. It used to
    // become min: 0 and sit at the bottom of the ladder, enterable by anyone.
    const withUnknown = [...GLOBAL, { id: 'inferno', name: 'Inferno' }];
    const built = buildZoneConfig(withUnknown, null);

    expect(built.find((z) => z.id === 'inferno')).toBeUndefined();
    expect(built.every((z) => Number.isFinite(z.min))).toBe(true);
    expect(validateZoneLadder(built).valid).toBe(true);
  });

  it('never returns an earned rung below the cool baseline', () => {
    const built = buildZoneConfig(GLOBAL, null);
    built.slice(1).forEach((zone) => {
      expect(zone.min).toBeGreaterThanOrEqual(MIN_COOL_BASELINE);
    });
  });
});
