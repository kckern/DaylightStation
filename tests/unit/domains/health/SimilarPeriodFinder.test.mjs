import { describe, it, expect, vi } from 'vitest';
import { SimilarPeriodFinder } from '#domains/health/services/SimilarPeriodFinder.mjs';

// Deterministic baseline signature used across most cases.
const BASE_SIGNATURE = {
  weight_avg_lbs: 175,
  weight_delta_lbs: -1.2,
  protein_avg_g: 130,
  calorie_avg: 1900,
  tracking_rate: 0.85,
};

describe('SimilarPeriodFinder', () => {
  it('ranks periods by composite score (more-similar wins)', () => {
    const finder = new SimilarPeriodFinder();
    const closeStats = { ...BASE_SIGNATURE }; // identical → score 1.0
    const farStats = {
      weight_avg_lbs: 205, // diff 30 → 0
      weight_delta_lbs: 8.8, // diff 10 → 0
      protein_avg_g: 30, // diff 100 → 0
      calorie_avg: 400, // diff 1500 → 0
      tracking_rate: -0.15, // diff 1.0 → 0
    };

    const matches = finder.findSimilar({
      signature: BASE_SIGNATURE,
      periods: [
        { name: 'far-period', stats: farStats },
        { name: 'close-period', stats: closeStats },
      ],
    });

    expect(matches).toHaveLength(2);
    expect(matches[0].name).toBe('close-period');
    expect(matches[0].score).toBeCloseTo(1.0, 5);
    expect(matches[1].name).toBe('far-period');
    expect(matches[1].score).toBeCloseTo(0.0, 5);
  });

  it('respects maxResults', () => {
    const finder = new SimilarPeriodFinder();
    const periods = [
      { name: 'p1', stats: { ...BASE_SIGNATURE } },
      { name: 'p2', stats: { ...BASE_SIGNATURE, weight_avg_lbs: 180 } },
      { name: 'p3', stats: { ...BASE_SIGNATURE, weight_avg_lbs: 185 } },
      { name: 'p4', stats: { ...BASE_SIGNATURE, weight_avg_lbs: 190 } },
    ];

    const matches = finder.findSimilar({
      signature: BASE_SIGNATURE,
      periods,
      maxResults: 2,
    });

    expect(matches).toHaveLength(2);
    expect(matches[0].name).toBe('p1');
    expect(matches[1].name).toBe('p2');
  });

  it('returns dimensionScores per match for explainability', () => {
    const finder = new SimilarPeriodFinder();
    // Period differs only in weight_avg_lbs by 15 → that dim score = 1 - 15/30 = 0.5
    const periodStats = { ...BASE_SIGNATURE, weight_avg_lbs: 190 };
    const matches = finder.findSimilar({
      signature: BASE_SIGNATURE,
      periods: [{ name: 'partial', stats: periodStats }],
    });

    expect(matches).toHaveLength(1);
    const m = matches[0];
    expect(m.dimensionScores).toBeDefined();
    expect(m.dimensionScores.weight_avg_lbs).toBeCloseTo(0.5, 5);
    expect(m.dimensionScores.weight_delta_lbs).toBeCloseTo(1.0, 5);
    expect(m.dimensionScores.protein_avg_g).toBeCloseTo(1.0, 5);
    expect(m.dimensionScores.calorie_avg).toBeCloseTo(1.0, 5);
    expect(m.dimensionScores.tracking_rate).toBeCloseTo(1.0, 5);
    // composite = (0.5 + 1 + 1 + 1 + 1) / 5 = 0.9
    expect(m.score).toBeCloseTo(0.9, 5);
  });

  it('handles missing dimensions gracefully (partial score from present dims)', () => {
    const finder = new SimilarPeriodFinder();
    // Signature only has weight + protein. Period only has weight + protein.
    // weight diff = 6 → 1 - 6/30 = 0.8
    // protein diff = 20 → 1 - 20/100 = 0.8
    // average over 2 present dims = 0.8
    const matches = finder.findSimilar({
      signature: { weight_avg_lbs: 180, protein_avg_g: 150 },
      periods: [{
        name: 'partial-dims',
        stats: { weight_avg_lbs: 186, protein_avg_g: 130 },
      }],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBeCloseTo(0.8, 5);
    expect(Object.keys(matches[0].dimensionScores)).toEqual(
      expect.arrayContaining(['weight_avg_lbs', 'protein_avg_g']),
    );
    expect(matches[0].dimensionScores).not.toHaveProperty('calorie_avg');
    expect(matches[0].dimensionScores).not.toHaveProperty('tracking_rate');
    expect(matches[0].dimensionScores).not.toHaveProperty('weight_delta_lbs');
  });

  it('returns empty array if no periods provided', () => {
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const finder = new SimilarPeriodFinder({ logger });
    const matches = finder.findSimilar({
      signature: BASE_SIGNATURE,
      periods: [],
    });
    expect(matches).toEqual([]);
    // No-periods warn for non-empty signature
    expect(logger.warn).toHaveBeenCalledWith(
      'similar_period.no_periods',
      expect.any(Object),
    );
  });

  it('tied scores break by period name (stable sort)', () => {
    const finder = new SimilarPeriodFinder();
    // Three periods with identical stats → identical scores.
    const matches = finder.findSimilar({
      signature: BASE_SIGNATURE,
      periods: [
        { name: 'charlie', stats: { ...BASE_SIGNATURE } },
        { name: 'alpha', stats: { ...BASE_SIGNATURE } },
        { name: 'bravo', stats: { ...BASE_SIGNATURE } },
      ],
    });

    expect(matches.map(m => m.name)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('signatures with all-mismatched dimensions still rank-order correctly', () => {
    const finder = new SimilarPeriodFinder();
    // All dims are far off, but some periods are slightly closer than others.
    const sig = {
      weight_avg_lbs: 100,
      weight_delta_lbs: 0,
      protein_avg_g: 50,
      calorie_avg: 1000,
      tracking_rate: 0.5,
    };
    // periodA differs by half-scale on every dim (score 0.5 per dim → 0.5 avg)
    const periodA = {
      name: 'half',
      stats: {
        weight_avg_lbs: 115, // 15/30 = 0.5 diff → 0.5
        weight_delta_lbs: 5, // 5/10 = 0.5 → 0.5
        protein_avg_g: 100, // 50/100 = 0.5 → 0.5
        calorie_avg: 1750, // 750/1500 = 0.5 → 0.5
        tracking_rate: 0.0, // 0.5/1 = 0.5 → 0.5
      },
    };
    // periodB differs by full-scale on every dim (score 0 per dim → 0 avg)
    const periodB = {
      name: 'full',
      stats: {
        weight_avg_lbs: 130,
        weight_delta_lbs: 10,
        protein_avg_g: 150,
        calorie_avg: 2500,
        tracking_rate: -0.5,
      },
    };

    const matches = finder.findSimilar({
      signature: sig,
      periods: [periodB, periodA],
    });

    expect(matches[0].name).toBe('half');
    expect(matches[0].score).toBeCloseTo(0.5, 5);
    expect(matches[1].name).toBe('full');
    expect(matches[1].score).toBeCloseTo(0.0, 5);
  });

  it('validates input: signature must be object, periods must be array', () => {
    const finder = new SimilarPeriodFinder();

    expect(() => finder.findSimilar({
      signature: null,
      periods: [],
    })).toThrow(TypeError);

    expect(() => finder.findSimilar({
      signature: 'not-an-object',
      periods: [],
    })).toThrow(TypeError);

    expect(() => finder.findSimilar({
      signature: BASE_SIGNATURE,
      periods: 'not-an-array',
    })).toThrow(TypeError);

    expect(() => finder.findSimilar({
      signature: BASE_SIGNATURE,
      periods: null,
    })).toThrow(TypeError);
  });
});
