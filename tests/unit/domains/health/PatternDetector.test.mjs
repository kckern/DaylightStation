import { describe, it, expect, vi } from 'vitest';
import { PatternDetector } from '#domains/health/services/PatternDetector.mjs';

// ----------------------------------------------------------------------------
// PatternDetector tests — primitive-driven detector (F1-A refactor).
//
// Patterns are NOT hardcoded in PatternDetector. Each playbook entry is just
// a composition of primitive checks (e.g. pace_stdev_seconds_lt, protein_avg_lt_g)
// keyed by the names that primitives are registered under in code. These tests
// drive the public detect() API with synthetic playbook entries that exercise
// each primitive — including a regression test that an arbitrary new pattern
// name composes correctly so long as its primitives exist.
// ----------------------------------------------------------------------------

const USER_GOALS = {
  calories_min: 1700,
  calories_max: 2100,
  protein_min: 140,
};

// --- Helpers to build deterministic windows ---

function makeRunWindow({ paces, hrs }) {
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
  describe('public API basics', () => {
    it('returns empty array for empty windows', () => {
      const detector = new PatternDetector();
      const result = detector.detect({
        windows: { nutrition: [], weight: [], workouts: [], compliance: {} },
        playbookPatterns: [
          {
            name: 'arbitrary',
            type: 'failure_mode',
            detection: { pace_stdev_seconds_lt: 60, hr_stdev_bpm_lt: 3, window_runs: 5 },
          },
        ],
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
  });

  describe('primitive composition (AND semantics)', () => {
    it('detection fires when all primitives match', () => {
      const detector = new PatternDetector();
      const runs = makeRunWindow({
        paces: [330, 332, 331, 330, 329],
        hrs: [150, 151, 150, 150, 151],
      });
      const result = detector.detect({
        windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
        playbookPatterns: [{
          name: 'flat-running-block',
          type: 'failure_mode',
          detection: { pace_stdev_seconds_lt: 60, hr_stdev_bpm_lt: 3, window_runs: 5 },
          recommended_response: 'Add an interval session.',
          severity: 'medium',
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('flat-running-block');
      expect(result[0].type).toBe('failure_mode');
      expect(result[0].severity).toBe('medium');
      expect(result[0].memoryKey).toBe('pattern_flat-running-block_last_flagged');
      expect(result[0].evidence).toMatchObject({
        pace_stdev_seconds: expect.any(Number),
        hr_stdev_bpm: expect.any(Number),
      });
    });

    it('detection does NOT fire when one primitive fails (AND)', () => {
      const detector = new PatternDetector();
      const runs = makeRunWindow({
        paces: [330, 331, 330, 329, 332], // pace flat
        hrs: [140, 155, 145, 160, 150],   // HR variable
      });
      const result = detector.detect({
        windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
        playbookPatterns: [{
          name: 'flat-running-block',
          type: 'failure_mode',
          detection: { pace_stdev_seconds_lt: 60, hr_stdev_bpm_lt: 3, window_runs: 5 },
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toEqual([]);
    });

    it('returns null (no detection) when insufficient data for a primitive', () => {
      const detector = new PatternDetector();
      const runs = makeRunWindow({
        paces: [330, 332, 331], // only 3 runs, window asks for 5
        hrs: [150, 151, 150],
      });
      const result = detector.detect({
        windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
        playbookPatterns: [{
          name: 'flat-running-block',
          type: 'failure_mode',
          detection: { pace_stdev_seconds_lt: 60, hr_stdev_bpm_lt: 3, window_runs: 5 },
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toEqual([]);
    });
  });

  describe('individual primitives', () => {
    it('protein_avg_lt_g + breakfast_skipped_days_7d_gt detects fasting pattern', () => {
      const detector = new PatternDetector();
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
        playbookPatterns: [{
          name: 'fasting-trap',
          type: 'failure_mode',
          detection: {
            protein_avg_lt_g: 100,
            breakfast_skipped_days_7d_gt: 4,
          },
          severity: 'high',
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].evidence.protein_avg_g).toBeLessThan(100);
      expect(result[0].evidence.breakfast_skipped_days_7d).toBeGreaterThan(4);
    });

    it('tracking_rate_14d_lt + weight_trend_3w_gt_lbs + protein_avg_drop_pct_gt detects rebound', () => {
      const detector = new PatternDetector();
      const nutrition = makeNutritionDays(21, (i) => (
        i < 10 ? { calories: 2000, protein: 150 } : { calories: 2100, protein: 110 }
      ));
      const weight = makeWeightSeries([
        178, 178.1, 178.2, 178.3, 178.4, 178.5, 178.6,
        178.7, 178.8, 178.9, 179.0, 179.1, 179.2, 179.3,
        179.4, 179.5, 179.6, 179.7, 179.8, 179.9, 179.5,
      ]);
      const compliance = { tracking_rate_14d: 0.4 };
      const result = detector.detect({
        windows: { nutrition, weight, workouts: [], compliance },
        playbookPatterns: [{
          name: 'post-cut-rebound',
          type: 'failure_mode',
          detection: {
            tracking_rate_14d_lt: 0.5,
            weight_trend_3w_gt_lbs: 1.0,
            protein_avg_drop_pct_gt: 0.15,
          },
          severity: 'high',
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].evidence.weight_trend_3w_lbs).toBeGreaterThan(1.0);
      expect(result[0].evidence.protein_avg_drop_pct).toBeGreaterThan(0.15);
      expect(result[0].evidence.tracking_rate_14d).toBeLessThan(0.5);
    });

    it('tracking_rate_14d_lt does NOT fire when weight stable (other primitives fail)', () => {
      const detector = new PatternDetector();
      const nutrition = makeNutritionDays(21, (i) => (
        i < 10 ? { calories: 2000, protein: 150 } : { calories: 2100, protein: 110 }
      ));
      const weight = makeWeightSeries(Array.from({ length: 21 }, () => 178));
      const compliance = { tracking_rate_14d: 0.4 };
      const result = detector.detect({
        windows: { nutrition, weight, workouts: [], compliance },
        playbookPatterns: [{
          name: 'post-cut-rebound',
          type: 'failure_mode',
          detection: {
            tracking_rate_14d_lt: 0.5,
            weight_trend_3w_gt_lbs: 1.0,
            protein_avg_drop_pct_gt: 0.15,
          },
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toEqual([]);
    });

    it('protein_avg_gt_g + tracking_rate_14d_gt + meal_repetition_index_gt detects success state', () => {
      const detector = new PatternDetector();
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
        playbookPatterns: [{
          name: 'tracked-cut-formula',
          type: 'success_mode',
          detection: {
            protein_avg_gt_g: 140,
            tracking_rate_14d_gt: 0.9,
            meal_repetition_index_gt: 0.6,
          },
          severity: 'low',
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('success_mode');
      expect(result[0].evidence.protein_avg_g).toBeGreaterThan(140);
    });

    it('weight_delta_lt_lbs + calorie_avg_lt + protein_avg_gt_g detects active cut', () => {
      const detector = new PatternDetector();
      const nutrition = makeNutritionDays(14, () => ({ calories: 1850, protein: 160 }));
      const weight = makeWeightSeries([
        180, 179.9, 179.8, 179.7, 179.6, 179.5, 179.4,
        179.3, 179.2, 179.1, 179.0, 178.9, 178.8, 178.6,
      ]);
      const result = detector.detect({
        windows: { nutrition, weight, workouts: [], compliance: {} },
        playbookPatterns: [{
          name: 'active-cut',
          type: 'success_mode',
          detection: {
            protein_avg_gt_g: 140,
            calorie_avg_lt: 2100,
            weight_delta_lt_lbs: -1,
            weight_delta_window_days: 14,
          },
          severity: 'low',
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].evidence.weight_delta_lbs).toBeLessThan(-1);
      expect(result[0].evidence.calorie_avg).toBeLessThan(2100);
      expect(result[0].evidence.protein_avg_g).toBeGreaterThanOrEqual(140);
    });

    it('bike_workouts_30d_gt + tracking_rate_14d_lt + weight_delta_gt_lbs detects volume-without-tracking pattern', () => {
      const detector = new PatternDetector();
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
        playbookPatterns: [{
          name: 'volume-without-tracking',
          type: 'failure_mode',
          detection: {
            bike_workouts_30d_gt: 5,
            tracking_rate_14d_lt: 0.7,
            weight_delta_gt_lbs: 1,
            weight_delta_window_days: 21,
          },
          severity: 'medium',
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].evidence.bike_workouts_30d).toBe(6);
      expect(result[0].evidence.tracking_rate_14d).toBeLessThan(0.7);
      expect(result[0].evidence.weight_delta_lbs).toBeGreaterThan(1);
    });

    it('programmed_workout_present + protein_avg_gt_g + calorie_avg_gt detects coached bulk', () => {
      const detector = new PatternDetector();
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
        playbookPatterns: [{
          name: 'coached-bulk',
          type: 'success_mode',
          detection: {
            programmed_workout_present: true,
            protein_avg_gt_g: 140,
            calorie_avg_gt: 2100,
          },
          severity: 'low',
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].evidence.programmed_workout_present).toBe(true);
      expect(result[0].evidence.calorie_avg).toBeGreaterThan(2100);
      expect(result[0].evidence.protein_avg_g).toBeGreaterThanOrEqual(140);
    });
  });

  describe('confidence math', () => {
    it('confidence is 1.0 when all signals exceed threshold strongly', () => {
      const detector = new PatternDetector();
      const nutrition = makeNutritionDays(7, () => ({
        calories: 1500,
        protein: 50,
        food_items: [{ name: 'late lunch', timestamp: '13:00' }],
      }));
      const result = detector.detect({
        windows: { nutrition, weight: [], workouts: [], compliance: {} },
        playbookPatterns: [{
          name: 'fasting-trap',
          type: 'failure_mode',
          detection: { protein_avg_lt_g: 100, breakfast_skipped_days_7d_gt: 4 },
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe(1.0);
    });

    it('confidence < 1.0 when signals are borderline', () => {
      const detector = new PatternDetector();
      const nutrition = makeNutritionDays(7, (i) => {
        if (i < 5) {
          return { calories: 1700, protein: 95, food_items: [{ name: 'lunch', timestamp: '12:30' }] };
        }
        return { calories: 1700, protein: 95, food_items: [{ name: 'breakfast', timestamp: '08:00' }] };
      });
      const result = detector.detect({
        windows: { nutrition, weight: [], workouts: [], compliance: {} },
        playbookPatterns: [{
          name: 'fasting-trap',
          type: 'failure_mode',
          detection: { protein_avg_lt_g: 100, breakfast_skipped_days_7d_gt: 4 },
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBeLessThan(1.0);
      expect(result[0].confidence).toBeGreaterThan(0);
    });
  });

  describe('regression: F1-A — patterns are pure YAML', () => {
    it('a novel pattern name composes correctly when its primitives exist', () => {
      // The F1-A guarantee: code holds primitives, YAML holds compositions.
      // A user can ship a brand-new pattern named "weekend-binge-collapse"
      // by writing it in their playbook YAML — no code change needed.
      const detector = new PatternDetector();
      const nutrition = makeNutritionDays(14, () => ({ calories: 2500, protein: 90 }));
      const result = detector.detect({
        windows: { nutrition, weight: [], workouts: [], compliance: {} },
        playbookPatterns: [{
          name: 'weekend-binge-collapse', // <-- previously unknown pattern name
          type: 'failure_mode',
          detection: {
            protein_avg_lt_g: 100,
            calorie_avg_gt: 2400,
          },
          recommended_response: 'Anchor weekend protein.',
          severity: 'medium',
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('weekend-binge-collapse');
      expect(result[0].type).toBe('failure_mode');
      expect(result[0].severity).toBe('medium');
      expect(result[0].evidence).toMatchObject({
        protein_avg_g: expect.any(Number),
        calorie_avg: expect.any(Number),
      });
      expect(result[0].evidence.protein_avg_g).toBeLessThan(100);
      expect(result[0].evidence.calorie_avg).toBeGreaterThan(2400);
    });

    it('an unknown primitive in the detection block returns null + emits warn', () => {
      const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
      const detector = new PatternDetector({ logger });
      const result = detector.detect({
        windows: {
          nutrition: makeNutritionDays(14, () => ({ calories: 1800, protein: 150 })),
          weight: [],
          workouts: [],
          compliance: {},
        },
        playbookPatterns: [{
          name: 'experimental',
          type: 'failure_mode',
          detection: {
            protein_avg_gt_g: 100, // valid
            mood_score_lt: 5,      // unknown primitive
          },
        }],
        userGoals: USER_GOALS,
      });
      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        'pattern_detector.unknown_primitive',
        expect.objectContaining({ name: 'experimental', primitive: 'mood_score_lt' }),
      );
    });

    it('metadata-only keys (window_runs, weight_delta_window_days) are not treated as primitives', () => {
      const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
      const detector = new PatternDetector({ logger });
      const runs = makeRunWindow({
        paces: [330, 332, 331, 330, 329],
        hrs: [150, 151, 150, 150, 151],
      });
      detector.detect({
        windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
        playbookPatterns: [{
          name: 'metadata-keys-ok',
          type: 'failure_mode',
          detection: {
            window_runs: 5,
            weight_delta_window_days: 14,
            pace_stdev_seconds_lt: 60,
            hr_stdev_bpm_lt: 3,
          },
        }],
        userGoals: USER_GOALS,
      });
      // No unknown_primitive warnings for metadata keys
      const unknownCalls = logger.warn.mock.calls
        .filter(([event]) => event === 'pattern_detector.unknown_primitive');
      expect(unknownCalls).toEqual([]);
    });
  });

  describe('output shape', () => {
    it('memoryKey is stable: pattern_<name>_last_flagged', () => {
      const detector = new PatternDetector();
      const runs = makeRunWindow({
        paces: [330, 332, 331, 330, 329],
        hrs: [150, 151, 150, 150, 151],
      });
      const result = detector.detect({
        windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
        playbookPatterns: [{
          name: 'whatever-the-user-named-it',
          type: 'failure_mode',
          detection: { pace_stdev_seconds_lt: 60, hr_stdev_bpm_lt: 3, window_runs: 5 },
        }],
        userGoals: USER_GOALS,
      });
      expect(result[0].memoryKey).toBe('pattern_whatever-the-user-named-it_last_flagged');
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
        playbookPatterns: [{
          name: 'whatever',
          type: 'failure_mode',
          detection: { pace_stdev_seconds_lt: 60, hr_stdev_bpm_lt: 3, window_runs: 5 },
        }],
        userGoals: USER_GOALS,
      });
      expect(logger.info).toHaveBeenCalledWith(
        'pattern_detector.match',
        expect.objectContaining({ name: 'whatever' }),
      );
    });

    it('evidence object reflects the primitives invoked', () => {
      const detector = new PatternDetector();
      const runs = makeRunWindow({
        paces: [330, 332, 331, 330, 329],
        hrs: [150, 151, 150, 150, 151],
      });
      const result = detector.detect({
        windows: { nutrition: [], weight: [], workouts: runs, compliance: {} },
        playbookPatterns: [{
          name: 'whatever',
          type: 'failure_mode',
          detection: { pace_stdev_seconds_lt: 60, hr_stdev_bpm_lt: 3, window_runs: 5 },
        }],
        userGoals: USER_GOALS,
      });
      expect(result[0].evidence.pace_stdev_seconds).toBeGreaterThanOrEqual(0);
      expect(result[0].evidence.hr_stdev_bpm).toBeGreaterThanOrEqual(0);
      expect(result[0].evidence.pace_stdev_seconds).toBeLessThan(60);
      expect(result[0].evidence.hr_stdev_bpm).toBeLessThan(3);
    });
  });
});
