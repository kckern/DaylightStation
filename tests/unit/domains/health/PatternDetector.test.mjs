import { describe, it, expect, vi } from 'vitest';
import { PatternDetector } from '#domains/health/services/PatternDetector.mjs';

// --- Playbook entry fixtures (mirrors fixture playbook.yml shape) ---

const PLAYBOOK_SAME_JOG_RUT = {
  name: 'same-jog-rut',
  type: 'failure_mode',
  detection: {
    pace_stdev_seconds_lt: 60,
    hr_stdev_bpm_lt: 3,
    window_runs: 5,
  },
  description: 'Pace and HR variance collapse.',
  recommended_response: 'Add an interval session.',
  severity: 'medium',
};

const PLAYBOOK_IF_TRAP = {
  name: 'if-trap-risk',
  type: 'failure_mode',
  detection: {
    protein_avg_lt_g: 100,
    breakfast_skipped_days_7d_gt: 4,
  },
  description: 'IF + low protein + skipped breakfast.',
  recommended_response: 'Anchor 30g+ protein within 60min of waking.',
  severity: 'high',
};

const PLAYBOOK_MAINT_DRIFT = {
  name: 'maintenance-drift',
  type: 'failure_mode',
  detection: {
    tracking_rate_14d_lt: 0.5,
    weight_trend_3w_gt_lbs: 1.0,
    protein_avg_drop_pct_gt: 0.15,
  },
  description: 'Post-cut rebound signature.',
  recommended_response: 'Re-anchor with the tracked-cut formula for 7 days.',
  severity: 'high',
};

const PLAYBOOK_TRACKED_CUT = {
  name: 'on-protocol-tracked-cut',
  type: 'success_mode',
  detection: {
    protein_avg_gt_g: 140,
    tracking_rate_14d_gt: 0.9,
    meal_repetition_index_gt: 0.6,
  },
  description: 'High-protein anchor + tracked.',
  recommended_response: 'Keep going.',
  severity: 'low',
};

const PLAYBOOK_CUT_MODE = {
  name: 'cut-mode',
  type: 'success_mode',
  detection: {
    protein_avg_gt_g: 140,
    weight_delta_14d_lt_lbs: -1,
  },
  description: 'On-target cut.',
  recommended_response: 'Maintain protocol.',
  severity: 'low',
};

const PLAYBOOK_BIKE_TRAP = {
  name: 'bike-commute-trap',
  type: 'failure_mode',
  detection: {
    bike_workouts_30d_gt: 5,
    tracking_rate_lt: 0.7,
    weight_delta_lbs_gt: 1,
  },
  description: 'Bike heavy + casual tracking + weight rising.',
  recommended_response: 'Tighten tracking; reassess fueling.',
  severity: 'medium',
};

const PLAYBOOK_COACHED_BULK = {
  name: 'on-protocol-coached-bulk',
  type: 'success_mode',
  detection: {
    protein_avg_gt_g: 140,
    calorie_surplus_required: true,
  },
  description: 'Programmed bulk with adequate protein and surplus.',
  recommended_response: 'Stay the course.',
  severity: 'low',
};

const USER_GOALS = {
  calories_min: 1700,
  calories_max: 2100,
  protein_min: 140,
};

// --- Helpers to build deterministic windows ---

function makeRunWindow({ paces, hrs }) {
  // dates don't matter for the rut detector beyond order; latest first or last is irrelevant
  return paces.map((pace, i) => ({
    date: `2026-04-${String(20 + i).padStart(2, '0')}`,
    type: 'run',
    duration: 1800,
    name: 'morning run',
    pace_seconds_per_km: pace,
    average_hr: hrs[i],
  }));
}

function makeNutritionDays(count, perDay) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      ...perDay(i),
    });
  }
  return out;
}

function makeWeightSeries(values) {
  return values.map((lbs, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    lbs,
    fatPercent: 18,
  }));
}

// ----------------------------------------------------------------------------

describe('PatternDetector', () => {
  it('returns empty array for empty windows', () => {
    const detector = new PatternDetector();
    const result = detector.detect({
      windows: { nutrition: [], weight: [], workouts: [], compliance: {} },
      playbookPatterns: [PLAYBOOK_SAME_JOG_RUT, PLAYBOOK_IF_TRAP],
      userGoals: USER_GOALS,
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when playbookPatterns is missing/empty', () => {
    const detector = new PatternDetector();
    const windows = {
      nutrition: makeNutritionDays(14, () => ({ calories: 1900, protein: 150 })),
      weight: makeWeightSeries([180, 179, 178]),
      workouts: [],
      compliance: {},
    };
    expect(detector.detect({ windows, playbookPatterns: [] })).toEqual([]);
    expect(detector.detect({ windows, playbookPatterns: undefined })).toEqual([]);
  });

  it('detects same-jog-rut when pace+HR variance both collapse', () => {
    const detector = new PatternDetector();
    // 5 runs, near-zero variance for both signals
    const runs = makeRunWindow({
      paces: [330, 332, 331, 330, 329], // stdev ~1s
      hrs: [150, 151, 150, 150, 151], // stdev <1bpm
    });
    const result = detector.detect({
      windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
      playbookPatterns: [PLAYBOOK_SAME_JOG_RUT],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('same-jog-rut');
    expect(result[0].type).toBe('failure_mode');
    expect(result[0].severity).toBe('medium');
    expect(result[0].memoryKey).toBe('pattern_same-jog-rut_last_flagged');
    expect(result[0].evidence).toMatchObject({
      pace_stdev_seconds: expect.any(Number),
      hr_stdev_bpm: expect.any(Number),
      window_runs: 5,
    });
  });

  it('does NOT detect same-jog-rut when only pace variance collapses (HR still variable)', () => {
    const detector = new PatternDetector();
    const runs = makeRunWindow({
      paces: [330, 331, 330, 329, 332], // very flat
      hrs: [140, 155, 145, 160, 150], // wide spread, stdev ~7+
    });
    const result = detector.detect({
      windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
      playbookPatterns: [PLAYBOOK_SAME_JOG_RUT],
      userGoals: USER_GOALS,
    });
    expect(result).toEqual([]);
  });

  it('detects if-trap-risk with low protein + skipped breakfast', () => {
    const detector = new PatternDetector();
    // 7 days where protein avg < 100 and breakfast skipped on 5+ days (first food after 11:00)
    const nutrition = makeNutritionDays(7, () => ({
      calories: 1700,
      protein: 80,
      food_items: [
        { name: 'lunch chicken', timestamp: '12:30' },
        { name: 'evening rice', timestamp: '19:00' },
      ],
    }));
    const result = detector.detect({
      windows: { nutrition, weight: [], workouts: [], compliance: {} },
      playbookPatterns: [PLAYBOOK_IF_TRAP],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('if-trap-risk');
    expect(result[0].evidence).toMatchObject({
      protein_avg_g: expect.any(Number),
      breakfast_skipped_days_7d: expect.any(Number),
    });
    expect(result[0].evidence.breakfast_skipped_days_7d).toBeGreaterThan(4);
  });

  it('detects maintenance-drift with all 3 dimensions matching', () => {
    const detector = new PatternDetector();
    // 21 days of nutrition. First half has protein ~150, second half has protein ~110 (drop ~26%)
    const nutrition = makeNutritionDays(21, (i) => {
      if (i < 10) return { calories: 2000, protein: 150 };
      return { calories: 2100, protein: 110 };
    });
    // 21 days of weight, trending up by 1.5 lbs over 3 weeks
    const weight = makeWeightSeries([
      178, 178.1, 178.2, 178.3, 178.4, 178.5, 178.6,
      178.7, 178.8, 178.9, 179.0, 179.1, 179.2, 179.3,
      179.4, 179.5, 179.6, 179.7, 179.8, 179.9, 179.5,
    ]);
    // tracking rate 14d < 0.5 — set compliance window-style
    const compliance = {
      tracking_rate_14d: 0.4, // explicit override
    };
    const result = detector.detect({
      windows: { nutrition, weight, workouts: [], compliance },
      playbookPatterns: [PLAYBOOK_MAINT_DRIFT],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('maintenance-drift');
    expect(result[0].evidence).toMatchObject({
      tracking_rate_14d: expect.any(Number),
      weight_trend_3w_lbs: expect.any(Number),
      protein_avg_drop_pct: expect.any(Number),
    });
    expect(result[0].evidence.weight_trend_3w_lbs).toBeGreaterThan(1.0);
    expect(result[0].evidence.protein_avg_drop_pct).toBeGreaterThan(0.15);
  });

  it('does NOT detect maintenance-drift when weight is stable', () => {
    const detector = new PatternDetector();
    const nutrition = makeNutritionDays(21, (i) => (
      i < 10 ? { calories: 2000, protein: 150 } : { calories: 2100, protein: 110 }
    ));
    // Stable weight — no trend
    const weight = makeWeightSeries(Array.from({ length: 21 }, () => 178));
    const compliance = { tracking_rate_14d: 0.4 };
    const result = detector.detect({
      windows: { nutrition, weight, workouts: [], compliance },
      playbookPatterns: [PLAYBOOK_MAINT_DRIFT],
      userGoals: USER_GOALS,
    });
    expect(result).toEqual([]);
  });

  it('detects on-protocol-tracked-cut', () => {
    const detector = new PatternDetector();
    // High protein consistently, ≥3 same foods recurring, tracking 14d >0.9
    const repeatedFoods = [
      { name: 'chicken breast', timestamp: '12:00' },
      { name: 'rice', timestamp: '12:00' },
      { name: 'broccoli', timestamp: '12:00' },
      { name: 'protein shake', timestamp: '07:00' },
    ];
    const nutrition = makeNutritionDays(14, () => ({
      calories: 1800,
      protein: 160,
      food_items: repeatedFoods,
    }));
    const compliance = { tracking_rate_14d: 0.95 };
    const result = detector.detect({
      windows: { nutrition, weight: [], workouts: [], compliance },
      playbookPatterns: [PLAYBOOK_TRACKED_CUT],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('on-protocol-tracked-cut');
    expect(result[0].type).toBe('success_mode');
    expect(result[0].evidence).toMatchObject({
      protein_avg_g: expect.any(Number),
      tracking_rate_14d: expect.any(Number),
      meal_repetition_index: expect.any(Number),
    });
  });

  it('detects bike-commute-trap', () => {
    const detector = new PatternDetector();
    // 6 bike workouts in last 30 days, tracking <0.7, weight rising >1lb
    const workouts = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-04-${String(i + 5).padStart(2, '0')}`,
      type: 'bike',
      duration: 2400,
      name: 'commute',
    }));
    const weight = makeWeightSeries(Array.from({ length: 21 }, (_, i) => 178 + (i * 0.1)));
    const compliance = { tracking_rate_14d: 0.5 };
    const result = detector.detect({
      windows: {
        nutrition: makeNutritionDays(14, () => ({ calories: 2200, protein: 130 })),
        weight,
        workouts,
        compliance,
      },
      playbookPatterns: [PLAYBOOK_BIKE_TRAP],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bike-commute-trap');
    expect(result[0].evidence).toMatchObject({
      bike_workouts_30d: 6,
      tracking_rate: expect.any(Number),
      weight_delta_lbs: expect.any(Number),
    });
  });

  it('detects cut-mode', () => {
    const detector = new PatternDetector();
    // Protein > target, calories < target, weight trending down at -1.4 over 14d
    const nutrition = makeNutritionDays(14, () => ({ calories: 1850, protein: 160 }));
    const weight = makeWeightSeries([
      180, 179.9, 179.8, 179.7, 179.6, 179.5, 179.4,
      179.3, 179.2, 179.1, 179.0, 178.9, 178.8, 178.6,
    ]);
    const result = detector.detect({
      windows: { nutrition, weight, workouts: [], compliance: {} },
      playbookPatterns: [PLAYBOOK_CUT_MODE],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('cut-mode');
    expect(result[0].type).toBe('success_mode');
    expect(result[0].evidence.weight_delta_14d_lbs).toBeLessThan(-1);
  });

  it('detects on-protocol-coached-bulk', () => {
    const detector = new PatternDetector();
    // Workouts with a programmed name + calorie surplus (avg > calories_max=2100) + protein >= 140
    const workouts = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      type: 'strength',
      duration: 3600,
      name: 'StrongLifts 5x5 - Workout A',
      program_name: 'StrongLifts',
    }));
    const nutrition = makeNutritionDays(14, () => ({ calories: 2400, protein: 180 }));
    const result = detector.detect({
      windows: { nutrition, weight: [], workouts, compliance: {} },
      playbookPatterns: [PLAYBOOK_COACHED_BULK],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('on-protocol-coached-bulk');
    expect(result[0].evidence).toMatchObject({
      program_present: true,
      calorie_avg: expect.any(Number),
      protein_avg_g: expect.any(Number),
    });
  });

  it('confidence is 1.0 when all signals exceed threshold strongly', () => {
    const detector = new PatternDetector();
    // Strongly low protein (50 vs 100) AND strongly skipped breakfasts (all 7 days)
    const nutrition = makeNutritionDays(7, () => ({
      calories: 1500,
      protein: 50,
      food_items: [{ name: 'late lunch', timestamp: '13:00' }],
    }));
    const result = detector.detect({
      windows: { nutrition, weight: [], workouts: [], compliance: {} },
      playbookPatterns: [PLAYBOOK_IF_TRAP],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(1.0);
  });

  it('confidence < 1.0 when signals are borderline', () => {
    const detector = new PatternDetector();
    // Borderline: protein 95 (just under 100), breakfast skipped exactly 5 days (just over 4)
    const nutrition = makeNutritionDays(7, (i) => {
      if (i < 5) {
        // skipped breakfast — first food at 12:30
        return {
          calories: 1700,
          protein: 95,
          food_items: [{ name: 'lunch', timestamp: '12:30' }],
        };
      }
      return {
        calories: 1700,
        protein: 95,
        food_items: [{ name: 'breakfast', timestamp: '08:00' }],
      };
    });
    const result = detector.detect({
      windows: { nutrition, weight: [], workouts: [], compliance: {} },
      playbookPatterns: [PLAYBOOK_IF_TRAP],
      userGoals: USER_GOALS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBeLessThan(1.0);
    expect(result[0].confidence).toBeGreaterThan(0);
  });

  it('evidence object includes the computed metric values', () => {
    const detector = new PatternDetector();
    const runs = makeRunWindow({
      paces: [330, 332, 331, 330, 329],
      hrs: [150, 151, 150, 150, 151],
    });
    const result = detector.detect({
      windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
      playbookPatterns: [PLAYBOOK_SAME_JOG_RUT],
      userGoals: USER_GOALS,
    });
    expect(result[0].evidence.pace_stdev_seconds).toBeGreaterThanOrEqual(0);
    expect(result[0].evidence.hr_stdev_bpm).toBeGreaterThanOrEqual(0);
    expect(result[0].evidence.pace_stdev_seconds).toBeLessThan(60);
    expect(result[0].evidence.hr_stdev_bpm).toBeLessThan(3);
  });

  it('memoryKey is stable: pattern_<name>_last_flagged', () => {
    const detector = new PatternDetector();
    const runs = makeRunWindow({
      paces: [330, 332, 331, 330, 329],
      hrs: [150, 151, 150, 150, 151],
    });
    const result = detector.detect({
      windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
      playbookPatterns: [PLAYBOOK_SAME_JOG_RUT],
      userGoals: USER_GOALS,
    });
    expect(result[0].memoryKey).toBe('pattern_same-jog-rut_last_flagged');
  });

  it('emits info log when a pattern matches', () => {
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const detector = new PatternDetector({ logger });
    const runs = makeRunWindow({
      paces: [330, 332, 331, 330, 329],
      hrs: [150, 151, 150, 150, 151],
    });
    detector.detect({
      windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
      playbookPatterns: [PLAYBOOK_SAME_JOG_RUT],
      userGoals: USER_GOALS,
    });
    expect(logger.info).toHaveBeenCalledWith(
      'pattern_detector.match',
      expect.objectContaining({ name: 'same-jog-rut' }),
    );
  });
});
