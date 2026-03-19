# Calorie Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a data layer that reconciles nutrition tracking with weight changes to derive implied intake, personalized BMR, and maintenance calories.

**Architecture:** Three new files following the existing DDD pattern: a pure domain service (`CalorieReconciliationService`) for the math, an application processor (`ReconciliationProcessor`) for I/O orchestration, and persistence methods added to the existing `YamlHealthDatastore`. Integrates at the tail of the harvest cycle via `AggregateHealthUseCase`.

**Tech Stack:** Node.js ES modules (.mjs), YAML persistence via existing `dataService`, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-03-18-calorie-reconciliation-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `backend/src/2_domains/health/services/CalorieReconciliationService.mjs` | Pure domain logic: energy balance solver, BMR derivation, confidence scoring |
| Create | `backend/src/3_applications/health/ReconciliationProcessor.mjs` | I/O orchestrator: loads inputs, calls domain service, persists output |
| Modify | `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs` | Add `loadReconciliationData()` / `saveReconciliationData()` methods |
| Modify | `backend/src/3_applications/health/ports/IHealthDataDatastore.mjs` | Add port methods for reconciliation |
| Modify | `backend/src/3_applications/health/AggregateHealthUseCase.mjs` | Call ReconciliationProcessor after health aggregation |
| Create | `tests/unit/domains/health/CalorieReconciliationService.test.mjs` | Unit tests for domain service |
| Create | `tests/unit/applications/health/ReconciliationProcessor.test.mjs` | Unit tests for processor with mocked deps |

---

### Task 1: Domain Service — Confidence Scoring

**Files:**
- Create: `tests/unit/domains/health/CalorieReconciliationService.test.mjs`
- Create: `backend/src/2_domains/health/services/CalorieReconciliationService.mjs`

- [ ] **Step 1: Write failing tests for `computeConfidence`**

```javascript
import { describe, it, expect } from 'vitest';
import { CalorieReconciliationService } from '#domains/health/services/CalorieReconciliationService.mjs';

describe('CalorieReconciliationService', () => {
  describe('computeConfidence', () => {
    it('returns 1.0 when all signals present', () => {
      expect(CalorieReconciliationService.computeConfidence({
        hasWeight: true, hasNutrition: true, hasSteps: true
      })).toBe(1.0);
    });

    it('returns 0.8 for weight + nutrition (no steps)', () => {
      expect(CalorieReconciliationService.computeConfidence({
        hasWeight: true, hasNutrition: true, hasSteps: false
      })).toBe(0.8);
    });

    it('returns 0.35 for weight only', () => {
      expect(CalorieReconciliationService.computeConfidence({
        hasWeight: true, hasNutrition: false, hasSteps: false
      })).toBeCloseTo(0.35);
    });

    it('returns 0 when no signals present', () => {
      expect(CalorieReconciliationService.computeConfidence({
        hasWeight: false, hasNutrition: false, hasSteps: false
      })).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `computeConfidence`**

```javascript
const CONFIDENCE_WEIGHTS = {
  weight: 0.35,
  nutrition: 0.45,
  steps: 0.20,
};

const HIGH_CONFIDENCE_THRESHOLD = 0.7;

export class CalorieReconciliationService {
  /**
   * Compute tracking confidence score for a day.
   * @param {{ hasWeight: boolean, hasNutrition: boolean, hasSteps: boolean }} signals
   * @returns {number} 0–1
   */
  static computeConfidence({ hasWeight, hasNutrition, hasSteps }) {
    let score = 0;
    if (hasWeight) score += CONFIDENCE_WEIGHTS.weight;
    if (hasNutrition) score += CONFIDENCE_WEIGHTS.nutrition;
    if (hasSteps) score += CONFIDENCE_WEIGHTS.steps;
    return parseFloat(score.toFixed(2));
  }
}

export default CalorieReconciliationService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/CalorieReconciliationService.mjs tests/unit/domains/health/CalorieReconciliationService.test.mjs
git commit -m "feat(health): add confidence scoring for calorie reconciliation"
```

---

### Task 2: Domain Service — Seed BMR (Katch-McArdle)

**Files:**
- Modify: `tests/unit/domains/health/CalorieReconciliationService.test.mjs`
- Modify: `backend/src/2_domains/health/services/CalorieReconciliationService.mjs`

- [ ] **Step 1: Write failing tests for `computeSeedBmr`**

```javascript
describe('computeSeedBmr', () => {
  it('computes Katch-McArdle BMR from weight and fat percent', () => {
    // 180 lbs, 20% fat → lean = 144 lbs = 65.3 kg → BMR = 370 + 21.6 * 65.3 = 1780
    const bmr = CalorieReconciliationService.computeSeedBmr(180, 20);
    expect(bmr).toBeCloseTo(1780, 0);
  });

  it('handles zero fat percent (all lean mass)', () => {
    // 180 lbs, 0% fat → lean = 180 lbs = 81.6 kg → BMR = 370 + 21.6 * 81.6 = 2133
    const bmr = CalorieReconciliationService.computeSeedBmr(180, 0);
    expect(bmr).toBeCloseTo(2133, 0);
  });

  it('returns null if weight is missing', () => {
    expect(CalorieReconciliationService.computeSeedBmr(null, 20)).toBeNull();
  });

  it('uses 25% fat as default when fat percent is missing', () => {
    // 180 lbs, 25% fat → lean = 135 lbs = 61.2 kg → BMR = 370 + 21.6 * 61.2 = 1692
    const bmr = CalorieReconciliationService.computeSeedBmr(180, null);
    expect(bmr).toBeCloseTo(1692, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs`
Expected: FAIL — `computeSeedBmr` is not a function

- [ ] **Step 3: Implement `computeSeedBmr`**

Add to `CalorieReconciliationService`:

```javascript
const LBS_TO_KG = 1 / 2.205;
const DEFAULT_FAT_PERCENT = 25;

/**
 * Compute seed BMR using Katch-McArdle formula.
 * @param {number|null} weightLbs
 * @param {number|null} fatPercent
 * @returns {number|null} BMR in calories/day, or null if weight missing
 */
static computeSeedBmr(weightLbs, fatPercent) {
  if (!weightLbs) return null;
  const fat = fatPercent ?? DEFAULT_FAT_PERCENT;
  const leanMassKg = weightLbs * (1 - fat / 100) * LBS_TO_KG;
  return Math.round(370 + 21.6 * leanMassKg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/CalorieReconciliationService.mjs tests/unit/domains/health/CalorieReconciliationService.test.mjs
git commit -m "feat(health): add Katch-McArdle seed BMR computation"
```

---

### Task 3: Domain Service — Rolling BMR Derivation

**Files:**
- Modify: `tests/unit/domains/health/CalorieReconciliationService.test.mjs`
- Modify: `backend/src/2_domains/health/services/CalorieReconciliationService.mjs`

- [ ] **Step 1: Write failing tests for `deriveRollingBmr`**

```javascript
describe('deriveRollingBmr', () => {
  const seedBmr = 1700;

  it('returns seed BMR when no high-confidence days', () => {
    const days = [
      { confidence: 0.35, solvedBmr: null },
      { confidence: 0.35, solvedBmr: null },
    ];
    const result = CalorieReconciliationService.deriveRollingBmr(days, seedBmr);
    expect(result.derivedBmr).toBe(seedBmr);
    expect(result.highConfidenceDayCount).toBe(0);
  });

  it('averages solved BMR from high-confidence days', () => {
    const days = [
      { confidence: 0.8, solvedBmr: 1650 },
      { confidence: 1.0, solvedBmr: 1750 },
      { confidence: 1.0, solvedBmr: 1700 },
      { confidence: 0.35, solvedBmr: null },
    ];
    const result = CalorieReconciliationService.deriveRollingBmr(days, seedBmr);
    expect(result.derivedBmr).toBe(1700);
    expect(result.highConfidenceDayCount).toBe(3);
  });

  it('falls back to seed when fewer than 3 high-confidence days', () => {
    const days = [
      { confidence: 0.8, solvedBmr: 1650 },
      { confidence: 0.8, solvedBmr: 1750 },
    ];
    const result = CalorieReconciliationService.deriveRollingBmr(days, seedBmr);
    expect(result.derivedBmr).toBe(seedBmr);
  });

  it('clamps derived BMR to ±30% of seed', () => {
    const days = [
      { confidence: 1.0, solvedBmr: 500 },  // way too low
      { confidence: 1.0, solvedBmr: 500 },
      { confidence: 1.0, solvedBmr: 500 },
    ];
    const result = CalorieReconciliationService.deriveRollingBmr(days, seedBmr);
    expect(result.derivedBmr).toBe(Math.round(seedBmr * 0.7)); // 1190
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs`
Expected: FAIL — `deriveRollingBmr` is not a function

- [ ] **Step 3: Implement `deriveRollingBmr`**

```javascript
const MIN_HIGH_CONFIDENCE_DAYS = 3;
const BMR_CLAMP_FACTOR = 0.3;

/**
 * Derive rolling BMR from high-confidence days.
 * @param {Array<{ confidence: number, solvedBmr: number|null }>} dailyRecords
 * @param {number} seedBmr - Katch-McArdle estimate
 * @returns {{ derivedBmr: number, highConfidenceDayCount: number }}
 */
static deriveRollingBmr(dailyRecords, seedBmr) {
  const highConfDays = dailyRecords.filter(
    d => d.confidence >= HIGH_CONFIDENCE_THRESHOLD && d.solvedBmr != null
  );

  if (highConfDays.length < MIN_HIGH_CONFIDENCE_DAYS) {
    return { derivedBmr: seedBmr, highConfidenceDayCount: highConfDays.length };
  }

  const avgBmr = Math.round(
    highConfDays.reduce((sum, d) => sum + d.solvedBmr, 0) / highConfDays.length
  );

  const lower = Math.round(seedBmr * (1 - BMR_CLAMP_FACTOR));
  const upper = Math.round(seedBmr * (1 + BMR_CLAMP_FACTOR));
  const clampedBmr = Math.max(lower, Math.min(upper, avgBmr));

  return { derivedBmr: clampedBmr, highConfidenceDayCount: highConfDays.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/CalorieReconciliationService.mjs tests/unit/domains/health/CalorieReconciliationService.test.mjs
git commit -m "feat(health): add rolling BMR derivation with clamping"
```

---

### Task 4: Domain Service — Core `reconcile()` Method

**Files:**
- Modify: `tests/unit/domains/health/CalorieReconciliationService.test.mjs`
- Modify: `backend/src/2_domains/health/services/CalorieReconciliationService.mjs`

- [ ] **Step 1: Write failing tests for `reconcile`**

```javascript
describe('reconcile', () => {
  const seedBmr = 1700;

  it('computes implied intake from energy balance equation', () => {
    const windowData = [{
      date: '2026-03-17',
      weightDelta: -0.2,  // lost 0.2 lbs
      trackedCalories: 1800,
      exerciseCalories: 300,
      neatCalories: 250,
      hasWeight: true,
      hasNutrition: true,
      hasSteps: true,
    }];
    // implied = (-0.2 * 3500) + 1700 + 300 + 250 = -700 + 2250 = 1550
    // But we need >= 3 high-confidence days for derived BMR, so uses seed
    const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
    expect(results).toHaveLength(1);
    expect(results[0].implied_intake).toBe(1550);
    expect(results[0].calorie_adjustment).toBe(1550 - 1800); // -250
    expect(results[0].tracking_accuracy).toBeCloseTo(1.0); // clamped: 1800/1550 > 1
  });

  it('sets tracking_accuracy to null when implied_intake <= 0', () => {
    const windowData = [{
      date: '2026-03-17',
      weightDelta: -1.5,  // big drop
      trackedCalories: 0,
      exerciseCalories: 0,
      neatCalories: 0,
      hasWeight: true,
      hasNutrition: false,
      hasSteps: false,
    }];
    // implied = (-1.5 * 3500) + 1700 + 0 + 0 = -5250 + 1700 = -3550
    const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
    expect(results[0].implied_intake).toBe(-3550);
    expect(results[0].tracking_accuracy).toBeNull();
  });

  it('interpolates NEAT for days missing step data', () => {
    const windowData = [
      { date: '2026-03-15', weightDelta: 0, trackedCalories: 2000,
        exerciseCalories: 0, neatCalories: 200, hasWeight: true,
        hasNutrition: true, hasSteps: true },
      { date: '2026-03-16', weightDelta: 0, trackedCalories: 2000,
        exerciseCalories: 0, neatCalories: null, hasWeight: true,
        hasNutrition: true, hasSteps: false },
      { date: '2026-03-17', weightDelta: 0, trackedCalories: 2000,
        exerciseCalories: 0, neatCalories: 400, hasWeight: true,
        hasNutrition: true, hasSteps: true },
    ];
    const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
    // Middle day NEAT interpolated: avg(200, 400) = 300
    expect(results[1].neat_calories).toBe(300);
  });

  it('handles extended no-logging period (all days untracked)', () => {
    const windowData = Array.from({ length: 4 }, (_, i) => ({
      date: `2026-03-${15 + i}`,
      weightDelta: 0,
      trackedCalories: 0,
      exerciseCalories: 0,
      neatCalories: 200,
      hasWeight: true,
      hasNutrition: false,
      hasSteps: true,
    }));
    const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
    // All days should have tracking_accuracy near 0 (no tracked calories)
    results.forEach(r => {
      expect(r.tracking_accuracy).toBe(0);
      expect(r.implied_intake).toBeGreaterThan(0);
    });
  });

  it('defaults NEAT to 0 when no step data at all', () => {
    const windowData = [{
      date: '2026-03-17',
      weightDelta: 0,
      trackedCalories: 2000,
      exerciseCalories: 0,
      neatCalories: null,
      hasWeight: true,
      hasNutrition: true,
      hasSteps: false,
    }];
    const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
    expect(results[0].neat_calories).toBe(0); // no adjacent days to interpolate from
  });

  it('computes rolling window outputs', () => {
    // 4 high-confidence days with enough data for derived BMR
    const windowData = Array.from({ length: 4 }, (_, i) => ({
      date: `2026-03-${15 + i}`,
      weightDelta: 0,
      trackedCalories: 2000,
      exerciseCalories: 300,
      neatCalories: 250,
      hasWeight: true,
      hasNutrition: true,
      hasSteps: true,
    }));
    const results = CalorieReconciliationService.reconcile(windowData, seedBmr);
    const last = results[results.length - 1];
    expect(last.derived_bmr).toBeDefined();
    expect(last.maintenance_calories).toBeDefined();
    expect(last.avg_tracking_accuracy).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs`
Expected: FAIL — `reconcile` is not a function

- [ ] **Step 3: Implement `reconcile`**

```javascript
const CALORIES_PER_LB = 3500;

/**
 * Reconcile nutrition tracking against weight changes.
 * @param {Array<Object>} windowData - daily input records
 * @param {number} seedBmr - Katch-McArdle estimate
 * @returns {Array<Object>} reconciliation records
 */
static reconcile(windowData, seedBmr) {
  if (!windowData?.length || !seedBmr) return [];

  // Step 1: Interpolate missing NEAT values
  const interpolated = CalorieReconciliationService.#interpolateNeat(windowData);

  // Step 2: First pass — compute per-day metrics using seed BMR
  const firstPass = interpolated.map(day => {
    const confidence = CalorieReconciliationService.computeConfidence({
      hasWeight: day.hasWeight,
      hasNutrition: day.hasNutrition,
      hasSteps: day.hasSteps,
    });

    const bmrForDay = seedBmr; // will be replaced in second pass
    const impliedIntake = Math.round(
      (day.weightDelta * CALORIES_PER_LB) + bmrForDay + day.exerciseCalories + day.neatCalories
    );

    // Solve BMR on high-confidence days
    const solvedBmr = confidence >= HIGH_CONFIDENCE_THRESHOLD
      ? Math.round(day.trackedCalories - (day.weightDelta * CALORIES_PER_LB) - day.exerciseCalories - day.neatCalories)
      : null;

    return { ...day, confidence, impliedIntake, solvedBmr };
  });

  // Step 3: Derive rolling BMR
  const { derivedBmr, highConfidenceDayCount } = CalorieReconciliationService.deriveRollingBmr(firstPass, seedBmr);

  // Step 4: Second pass — recompute with derived BMR + rolling outputs
  const totalNeat = interpolated.reduce((s, d) => s + (d.neatCalories || 0), 0);
  const totalExercise = interpolated.reduce((s, d) => s + (d.exerciseCalories || 0), 0);
  const avgNeat = Math.round(totalNeat / interpolated.length);
  const avgExercise = Math.round(totalExercise / interpolated.length);
  const maintenanceCalories = derivedBmr + avgNeat + avgExercise;

  // Compute per-day records
  const records = interpolated.map(day => {
    const confidence = CalorieReconciliationService.computeConfidence({
      hasWeight: day.hasWeight,
      hasNutrition: day.hasNutrition,
      hasSteps: day.hasSteps,
    });

    const impliedIntake = Math.round(
      (day.weightDelta * CALORIES_PER_LB) + derivedBmr + day.exerciseCalories + day.neatCalories
    );

    const calorieAdjustment = impliedIntake - day.trackedCalories;

    let trackingAccuracy = null;
    if (impliedIntake > 0) {
      trackingAccuracy = parseFloat(Math.min(1, day.trackedCalories / impliedIntake).toFixed(2));
    }

    return {
      date: day.date,
      weight_delta_lbs: day.weightDelta,
      tracked_calories: day.trackedCalories,
      exercise_calories: day.exerciseCalories,
      neat_calories: day.neatCalories,
      seed_bmr: seedBmr,
      implied_intake: impliedIntake,
      calorie_adjustment: calorieAdjustment,
      tracking_accuracy: trackingAccuracy,
      tracking_confidence: confidence,
      derived_bmr: derivedBmr,
      maintenance_calories: maintenanceCalories,
    };
  });

  // Compute window-wide avg_tracking_accuracy (same value on every record)
  const accuracies = records.map(r => r.tracking_accuracy).filter(a => a != null);
  const avgTrackingAccuracy = accuracies.length > 0
    ? parseFloat((accuracies.reduce((s, a) => s + a, 0) / accuracies.length).toFixed(2))
    : null;

  return records.map(r => ({ ...r, avg_tracking_accuracy: avgTrackingAccuracy }));
}

/**
 * Interpolate null NEAT values from adjacent days.
 * @private
 */
static #interpolateNeat(windowData) {
  return windowData.map((day, i) => {
    if (day.neatCalories != null) return { ...day };

    const prev = windowData.slice(0, i).reverse().find(d => d.neatCalories != null);
    const next = windowData.slice(i + 1).find(d => d.neatCalories != null);

    let interpolated = 0;
    if (prev && next) interpolated = Math.round((prev.neatCalories + next.neatCalories) / 2);
    else if (prev) interpolated = prev.neatCalories;
    else if (next) interpolated = next.neatCalories;

    return { ...day, neatCalories: interpolated };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/CalorieReconciliationService.mjs tests/unit/domains/health/CalorieReconciliationService.test.mjs
git commit -m "feat(health): implement core calorie reconciliation solver"
```

---

### Task 5: Persistence — Add Reconciliation Methods to YamlHealthDatastore

**Files:**
- Modify: `backend/src/3_applications/health/ports/IHealthDataDatastore.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs`

- [ ] **Step 1: Read current port interface**

Read: `backend/src/3_applications/health/ports/IHealthDataDatastore.mjs`
Understand existing method signatures.

- [ ] **Step 2: Add port methods**

Add to `IHealthDataDatastore`:

```javascript
async loadReconciliationData(userId) {
  throw new Error('Not implemented');
}

async saveReconciliationData(userId, data) {
  throw new Error('Not implemented');
}
```

- [ ] **Step 3: Read current YamlHealthDatastore**

Read: `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs`
Find the pattern used by `loadWeightData` / `saveHealthData`.

- [ ] **Step 4: Add implementation to YamlHealthDatastore**

Follow the same pattern as existing methods — use the private `#loadUserFile` / `#saveUserFile` helpers (NOT `dataService.readYaml` which does not exist):

```javascript
async loadReconciliationData(userId) {
  this.#logger.debug?.('health.store.loadReconciliation', { userId });
  return this.#loadUserFile(userId, 'lifelog/reconciliation');
}

async saveReconciliationData(userId, data) {
  this.#logger.debug?.('health.store.saveReconciliation', { userId, dates: Object.keys(data).length });
  this.#saveUserFile(userId, 'lifelog/reconciliation', data);
}
```

Note: `#loadUserFile` and `#saveUserFile` are existing private helpers (lines ~77-90) that handle username resolution via `#resolveUsername` (synchronous, not async) and delegate to `this.#dataService.user.read/write`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/ports/IHealthDataDatastore.mjs backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs
git commit -m "feat(health): add reconciliation persistence to health datastore"
```

---

### Task 6: Application Service — ReconciliationProcessor

**Files:**
- Create: `tests/unit/applications/health/ReconciliationProcessor.test.mjs`
- Create: `backend/src/3_applications/health/ReconciliationProcessor.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReconciliationProcessor from '#apps/health/ReconciliationProcessor.mjs';

describe('ReconciliationProcessor', () => {
  let processor;
  let mockHealthStore;

  beforeEach(() => {
    mockHealthStore = {
      loadWeightData: vi.fn().mockResolvedValue({
        '2026-03-14': { lbs_adjusted_average: 180.5, fat_percent_adjusted_average: 22 },
        '2026-03-15': { lbs_adjusted_average: 180.3, fat_percent_adjusted_average: 22 },
        '2026-03-16': { lbs_adjusted_average: 180.1, fat_percent_adjusted_average: 22 },
        '2026-03-17': { lbs_adjusted_average: 180.0, fat_percent_adjusted_average: 22 },
      }),
      loadNutritionData: vi.fn().mockResolvedValue({
        '2026-03-15': { calories: 1900 },
        '2026-03-16': { calories: 2100 },
        '2026-03-17': { calories: 0 },
      }),
      loadFitnessData: vi.fn().mockResolvedValue({
        '2026-03-15': { steps: { calories: 250 }, activities: [] },
        '2026-03-16': { steps: { calories: 300 }, activities: [{ calories: 400, minutes: 45 }] },
        '2026-03-17': { steps: { calories: 200 }, activities: [] },
      }),
      loadActivityData: vi.fn().mockResolvedValue({
        '2026-03-16': [{ calories: 410, minutes: 44 }],
      }),
      loadReconciliationData: vi.fn().mockResolvedValue({}),
      saveReconciliationData: vi.fn().mockResolvedValue(undefined),
    };

    processor = new ReconciliationProcessor({ healthStore: mockHealthStore });
  });

  it('loads data and produces reconciliation records', async () => {
    const results = await processor.process('kckern', { windowDays: 3 });
    expect(results).toHaveLength(3);
    expect(mockHealthStore.saveReconciliationData).toHaveBeenCalledOnce();
  });

  it('merges with existing reconciliation data on save', async () => {
    mockHealthStore.loadReconciliationData.mockResolvedValue({
      '2026-03-10': { implied_intake: 2000 },
    });
    await processor.process('kckern', { windowDays: 3 });
    const savedData = mockHealthStore.saveReconciliationData.mock.calls[0][1];
    expect(savedData['2026-03-10']).toBeDefined(); // old data preserved
    expect(savedData['2026-03-15']).toBeDefined(); // new data added
  });

  it('throws if healthStore is missing', () => {
    expect(() => new ReconciliationProcessor({})).toThrow('healthStore');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/health/ReconciliationProcessor.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ReconciliationProcessor**

```javascript
import { CalorieReconciliationService } from '#domains/health/services/CalorieReconciliationService.mjs';
import { HealthAggregator } from '#domains/health/services/HealthAggregationService.mjs';

export class ReconciliationProcessor {
  #healthStore;
  #logger;

  constructor(config) {
    if (!config.healthStore) {
      throw new Error('ReconciliationProcessor requires healthStore');
    }
    this.#healthStore = config.healthStore;
    this.#logger = config.logger || console;
  }

  /**
   * Run reconciliation for a user.
   * @param {string} userId
   * @param {{ windowDays?: number }} options
   * @returns {Array<Object>} reconciliation records
   */
  async process(userId, options = {}) {
    const windowDays = options.windowDays || 14;
    this.#logger.info?.('reconciliation.process.start', { userId, windowDays });

    // Load all inputs in parallel
    const [weightData, nutritionData, fitnessData, stravaData, existingRecon] = await Promise.all([
      this.#healthStore.loadWeightData(userId),
      this.#healthStore.loadNutritionData(userId),
      this.#healthStore.loadFitnessData(userId),
      this.#healthStore.loadActivityData(userId),
      this.#healthStore.loadReconciliationData(userId),
    ]);

    // Determine window: last N days with weight data, excluding today
    const weightDates = Object.keys(weightData).sort();
    if (weightDates.length < 2) {
      this.#logger.warn?.('reconciliation.process.insufficient_weight_data', { userId, dates: weightDates.length });
      return [];
    }

    // Exclude today — use most recent N dates before today
    const today = new Date().toISOString().slice(0, 10);
    const eligibleDates = weightDates.filter(d => d < today);
    const windowDates = eligibleDates.slice(-windowDays);

    if (windowDates.length < 2) {
      this.#logger.warn?.('reconciliation.process.insufficient_window', { userId });
      return [];
    }

    // Compute seed BMR from most recent weight entry
    const latestWeight = weightData[windowDates[windowDates.length - 1]];
    const seedBmr = CalorieReconciliationService.computeSeedBmr(
      latestWeight?.lbs_adjusted_average,
      latestWeight?.fat_percent_adjusted_average
    );

    if (!seedBmr) {
      this.#logger.warn?.('reconciliation.process.no_seed_bmr', { userId });
      return [];
    }

    // Build window data
    const windowData = windowDates.map((date, i) => {
      const prevDate = i > 0 ? windowDates[i - 1] : weightDates[weightDates.indexOf(date) - 1];
      const currWeight = weightData[date]?.lbs_adjusted_average;
      const prevWeight = prevDate ? weightData[prevDate]?.lbs_adjusted_average : null;
      const weightDelta = (currWeight != null && prevWeight != null) ? currWeight - prevWeight : 0;

      const nutrition = nutritionData[date];
      const fitness = fitnessData[date];
      const strava = stravaData[date];

      // Deduplicate exercise calories using HealthAggregator
      // Note: strava.yml entries may or may not have `calories` (only present if Strava API provided it).
      // FitnessSyncer activities reliably have calories. mergeWorkouts takes max(strava, fitness) for dupes.
      const stravaActivities = Array.isArray(strava) ? strava : [];
      const fitnessActivities = fitness?.activities || [];
      const mergedWorkouts = HealthAggregator.mergeWorkouts(stravaActivities, fitnessActivities);
      const exerciseCalories = mergedWorkouts.reduce((sum, w) => sum + (w.calories || 0), 0);

      return {
        date,
        weightDelta,
        trackedCalories: nutrition?.calories || 0,
        exerciseCalories,
        neatCalories: fitness?.steps?.calories ?? null,
        hasWeight: currWeight != null,
        hasNutrition: nutrition?.calories > 0,
        hasSteps: fitness?.steps?.calories != null,
      };
    });

    // Run domain reconciliation
    const results = CalorieReconciliationService.reconcile(windowData, seedBmr);

    // Merge with existing data and save
    const merged = { ...existingRecon };
    for (const record of results) {
      merged[record.date] = record;
    }
    await this.#healthStore.saveReconciliationData(userId, merged);

    this.#logger.info?.('reconciliation.process.complete', {
      userId, days: results.length, derivedBmr: results[results.length - 1]?.derived_bmr
    });

    return results;
  }
}

export default ReconciliationProcessor;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/applications/health/ReconciliationProcessor.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/ReconciliationProcessor.mjs tests/unit/applications/health/ReconciliationProcessor.test.mjs
git commit -m "feat(health): add ReconciliationProcessor application service"
```

---

### Task 7: Integration — Wire Into Harvest Cycle

**Files:**
- Modify: `backend/src/3_applications/health/AggregateHealthUseCase.mjs`

- [ ] **Step 1: Read AggregateHealthUseCase**

Read: `backend/src/3_applications/health/AggregateHealthUseCase.mjs`
Find where health aggregation completes (after `saveHealthData`). That's where reconciliation should run.

- [ ] **Step 2: Add logger and ReconciliationProcessor to AggregateHealthUseCase**

AggregateHealthUseCase currently has no `#logger` field. Add both:

```javascript
// In constructor:
this.#logger = config.logger || console;
this.#reconciliationProcessor = config.reconciliationProcessor || null;
```

Add the `#logger` and `#reconciliationProcessor` private field declarations at the top of the class.

Add after the health data save (at the end of `execute()`). Use the processor's own default window (14 days) — do NOT pass `daysBack` since that controls aggregation scope, not reconciliation window:

```javascript
// Run calorie reconciliation if processor is available
if (this.#reconciliationProcessor) {
  try {
    await this.#reconciliationProcessor.process(userId);
  } catch (error) {
    this.#logger.error?.('health.aggregate.reconciliation_failed', {
      userId, error: error.message
    });
    // Non-fatal — don't fail the whole aggregation
  }
}
```

- [ ] **Step 3: Update the composition root wiring**

The composition root is at `backend/src/0_system/bootstrap.mjs` (~line 2346), where `AggregateHealthUseCase` is instantiated as `healthService`. Add:

```javascript
import ReconciliationProcessor from '#apps/health/ReconciliationProcessor.mjs';

const reconciliationProcessor = new ReconciliationProcessor({ healthStore, logger });
const healthService = new AggregateHealthUseCase({
  healthStore,
  // ... existing deps
  reconciliationProcessor,
  logger,
});
```

- [ ] **Step 4: Run existing health tests to verify no regressions**

Run: `npx vitest run tests/unit/domains/health/ && npx vitest run tests/unit/applications/health/`
Expected: PASS — all existing tests still pass, reconciliation is optional (null check)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/AggregateHealthUseCase.mjs backend/src/0_system/bootstrap.mjs
git commit -m "feat(health): wire reconciliation into harvest cycle"
```

---

### Task 8: Manual Verification Against Live Data

**Files:** None (verification only)

- [ ] **Step 1: Read live weight data sample**

```bash
sudo docker exec daylight-station sh -c 'tail -50 data/users/kckern/lifelog/weight.yml'
```

Verify `lbs_adjusted_average` and `fat_percent_adjusted_average` fields exist.

- [ ] **Step 2: Read live nutriday data sample**

```bash
sudo docker exec daylight-station sh -c 'cat data/users/kckern/lifelog/nutrition/nutriday.yml | head -30'
```

Verify `calories` field exists per date.

- [ ] **Step 3: Read live fitness data sample**

```bash
sudo docker exec daylight-station sh -c 'cat data/users/kckern/lifelog/fitness.yml | head -30'
```

Verify `steps.calories` field exists.

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run tests/unit/domains/health/CalorieReconciliationService.test.mjs tests/unit/applications/health/ReconciliationProcessor.test.mjs
```

Expected: All tests PASS.

- [ ] **Step 5: Verify — no commit needed**

Task 8 is verification only. If all checks pass and tests are green, the implementation is complete. No additional files to commit.
