# Calorie Adjustment Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an overlay layer that uses reconciliation data to produce adjusted nutriday records, boost real-time AI portion estimates, and expose adjusted totals via the health API.

**Architecture:** A new domain service (`CalorieAdjustmentService`) handles the pure math (portion scaling, phantom entries, window stats). The existing `ReconciliationProcessor` gains a `nutritionItemsReader` dependency and calls the adjustment service after reconciliation to write `nutriday_adjusted.yml`. `LogFoodFromText`/`LogFoodFromImage` inject a portion multiplier into the AI prompt. The health API merges adjusted data alongside raw.

**Tech Stack:** Node.js ES modules (.mjs), YAML persistence via existing `dataService`, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-03-19-calorie-adjustment-layer-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `backend/src/2_domains/health/services/CalorieAdjustmentService.mjs` | Pure math: portion multiplier, item scaling, phantom entries, window stats |
| Create | `backend/src/3_applications/health/ports/INutritionItemsReader.mjs` | Read-only port for structured nutrition items by date |
| Modify | `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs` | Implement INutritionItemsReader + adjusted nutriday load/save |
| Modify | `backend/src/3_applications/health/ports/IHealthDataDatastore.mjs` | Add adjusted nutrition port methods |
| Modify | `backend/src/3_applications/health/ReconciliationProcessor.mjs` | Add nutritionItemsReader dep, call adjustment service, write adjusted nutriday |
| Modify | `backend/src/3_applications/nutribot/NutribotContainer.mjs` | Pass reconciliation data reader to use case constructors |
| Modify | `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs` | Read accuracy, inject portion multiplier into AI prompt |
| Modify | `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs` | Same prompt injection |
| Modify | `backend/src/2_domains/health/services/HealthAggregationService.mjs` | Add adjusted nutrition to aggregateDayMetrics |
| Modify | `backend/src/3_applications/health/AggregateHealthUseCase.mjs` | Load adjusted nutrition data, pass to aggregator |
| Modify | `backend/src/0_system/bootstrap.mjs` | Wire nutritionItemsReader into ReconciliationProcessor, pass reconciliation reader to NutribotContainer |
| Create | `tests/unit/domains/health/CalorieAdjustmentService.test.mjs` | Domain service tests |
| Create | `tests/unit/applications/health/ReconciliationProcessor.adjustment.test.mjs` | Adjustment integration tests |

---

### Task 1: Domain Service — Window Stats & Portion Multiplier

**Files:**
- Create: `tests/unit/domains/health/CalorieAdjustmentService.test.mjs`
- Create: `backend/src/2_domains/health/services/CalorieAdjustmentService.mjs`

- [ ] **Step 1: Write failing tests for `computeWindowStats` and `computePortionMultiplier`**

```javascript
import { describe, it, expect } from 'vitest';
import { CalorieAdjustmentService } from '#domains/health/services/CalorieAdjustmentService.mjs';

describe('CalorieAdjustmentService', () => {
  describe('computeWindowStats', () => {
    it('computes avg and std dev from reconciliation records', () => {
      const records = [
        { tracking_accuracy: 0.70 },
        { tracking_accuracy: 0.80 },
        { tracking_accuracy: 0.90 },
      ];
      const stats = CalorieAdjustmentService.computeWindowStats(records);
      expect(stats.avgAccuracy).toBeCloseTo(0.80, 2);
      expect(stats.stdDevAccuracy).toBeCloseTo(0.082, 2);
    });

    it('filters out null tracking_accuracy records', () => {
      const records = [
        { tracking_accuracy: 0.75 },
        { tracking_accuracy: null },
        { tracking_accuracy: 0.85 },
      ];
      const stats = CalorieAdjustmentService.computeWindowStats(records);
      expect(stats.avgAccuracy).toBeCloseTo(0.80, 2);
    });

    it('returns null stats when no valid records', () => {
      const stats = CalorieAdjustmentService.computeWindowStats([]);
      expect(stats.avgAccuracy).toBeNull();
      expect(stats.stdDevAccuracy).toBeNull();
    });
  });

  describe('computePortionMultiplier', () => {
    it('computes multiplier from tracking accuracy', () => {
      // accuracy 0.75 → multiplier 1.33
      const result = CalorieAdjustmentService.computePortionMultiplier(0.75, 0.75, 0.10);
      expect(result.multiplier).toBeCloseTo(1.33, 1);
      expect(result.phantomNeeded).toBe(false);
    });

    it('caps multiplier at max when accuracy is very low', () => {
      // accuracy 0.40, avg 0.75, std 0.10 → raw 2.5, max 1/(0.75-0.10)=1.54
      const result = CalorieAdjustmentService.computePortionMultiplier(0.40, 0.75, 0.10);
      expect(result.multiplier).toBeCloseTo(1.54, 1);
      expect(result.maxMultiplier).toBeCloseTo(1.54, 1);
      expect(result.phantomNeeded).toBe(true);
    });

    it('floors denominator at 0.1 to prevent extreme values', () => {
      const result = CalorieAdjustmentService.computePortionMultiplier(0.05, 0.10, 0.15);
      expect(result.maxMultiplier).toBe(10); // 1/0.1
      expect(result.multiplier).toBe(10); // capped at max
    });

    it('returns multiplier 1.0 when accuracy is 1.0', () => {
      const result = CalorieAdjustmentService.computePortionMultiplier(1.0, 0.90, 0.05);
      expect(result.multiplier).toBe(1.0);
      expect(result.phantomNeeded).toBe(false);
    });

    it('uses avg-only when stdDev is null (insufficient data)', () => {
      const result = CalorieAdjustmentService.computePortionMultiplier(0.50, 0.75, null);
      // max = 1/0.75 = 1.33, raw = 1/0.50 = 2.0, capped at 1.33
      expect(result.multiplier).toBeCloseTo(1.33, 1);
      expect(result.phantomNeeded).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/health/CalorieAdjustmentService.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `computeWindowStats` and `computePortionMultiplier`**

```javascript
const MIN_DENOMINATOR = 0.1;
const DEFAULT_MACRO_SPLIT = { proteinRatio: 0.30, carbsRatio: 0.40, fatRatio: 0.30 };

export class CalorieAdjustmentService {
  static computeWindowStats(reconciliationRecords) {
    const valid = reconciliationRecords.filter(r => r.tracking_accuracy != null);
    if (valid.length === 0) return { avgAccuracy: null, stdDevAccuracy: null };

    const avg = valid.reduce((s, r) => s + r.tracking_accuracy, 0) / valid.length;

    if (valid.length < 3) return { avgAccuracy: parseFloat(avg.toFixed(4)), stdDevAccuracy: null };

    const variance = valid.reduce((s, r) => s + Math.pow(r.tracking_accuracy - avg, 2), 0) / valid.length;
    const stdDev = Math.sqrt(variance);

    return {
      avgAccuracy: parseFloat(avg.toFixed(4)),
      stdDevAccuracy: parseFloat(stdDev.toFixed(4)),
    };
  }

  static computePortionMultiplier(trackingAccuracy, avgAccuracy, stdDevAccuracy) {
    if (trackingAccuracy >= 1.0) return { multiplier: 1.0, maxMultiplier: 1.0, phantomNeeded: false };

    const denominator = stdDevAccuracy != null
      ? Math.max(MIN_DENOMINATOR, avgAccuracy - stdDevAccuracy)
      : Math.max(MIN_DENOMINATOR, avgAccuracy);
    const maxMultiplier = parseFloat((1 / denominator).toFixed(2));

    const rawMultiplier = 1 / trackingAccuracy;
    const multiplier = parseFloat(Math.min(rawMultiplier, maxMultiplier).toFixed(2));
    const phantomNeeded = rawMultiplier > maxMultiplier;

    return { multiplier, maxMultiplier, phantomNeeded };
  }
}

export default CalorieAdjustmentService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/health/CalorieAdjustmentService.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/CalorieAdjustmentService.mjs tests/unit/domains/health/CalorieAdjustmentService.test.mjs
git commit -m "feat(health): add window stats and portion multiplier for calorie adjustment"
```

---

### Task 2: Domain Service — Item Scaling & Phantom Entries

**Files:**
- Modify: `tests/unit/domains/health/CalorieAdjustmentService.test.mjs`
- Modify: `backend/src/2_domains/health/services/CalorieAdjustmentService.mjs`

- [ ] **Step 1: Write failing tests for `adjustDayItems` and `computePhantomEntry`**

```javascript
describe('adjustDayItems', () => {
  it('scales grams and all macros proportionally', () => {
    const items = [{
      label: 'Chicken Breast', grams: 150, calories: 250, protein: 47,
      carbs: 0, fat: 5, fiber: 0, sugar: 0, sodium: 100, cholesterol: 80, color: 'yellow',
    }];
    const adjusted = CalorieAdjustmentService.adjustDayItems(items, 1.33);
    expect(adjusted[0].grams).toBe(200); // 150 * 1.33 = 199.5 → 200
    expect(adjusted[0].calories).toBe(333); // 250 * 1.33
    expect(adjusted[0].protein).toBe(63); // 47 * 1.33
    expect(adjusted[0].adjusted).toBe(true);
    expect(adjusted[0].original_grams).toBe(150);
  });

  it('returns items unchanged when multiplier is 1.0', () => {
    const items = [{ label: 'Apple', grams: 180, calories: 95, protein: 0, carbs: 25, fat: 0 }];
    const adjusted = CalorieAdjustmentService.adjustDayItems(items, 1.0);
    expect(adjusted[0].grams).toBe(180);
    expect(adjusted[0].adjusted).toBeUndefined();
  });

  it('handles empty items array', () => {
    expect(CalorieAdjustmentService.adjustDayItems([], 1.5)).toEqual([]);
  });
});

describe('computePhantomEntry', () => {
  it('creates phantom entry with macro split from day ratios', () => {
    const ratios = { proteinRatio: 0.30, carbsRatio: 0.40, fatRatio: 0.30 };
    const phantom = CalorieAdjustmentService.computePhantomEntry(500, ratios);
    expect(phantom.label).toBe('Estimated Untracked Intake');
    expect(phantom.calories).toBe(500);
    expect(phantom.protein).toBe(38); // 500 * 0.30 / 4
    expect(phantom.carbs).toBe(50);   // 500 * 0.40 / 4
    expect(phantom.fat).toBe(17);     // 500 * 0.30 / 9
    expect(phantom.phantom).toBe(true);
  });

  it('uses default 30/40/30 split when ratios are null', () => {
    const phantom = CalorieAdjustmentService.computePhantomEntry(300, null);
    expect(phantom.protein).toBe(23); // 300 * 0.30 / 4
    expect(phantom.carbs).toBe(30);   // 300 * 0.40 / 4
    expect(phantom.fat).toBe(10);     // 300 * 0.30 / 9
  });

  it('returns null when gap is zero or negative', () => {
    expect(CalorieAdjustmentService.computePhantomEntry(0, null)).toBeNull();
    expect(CalorieAdjustmentService.computePhantomEntry(-50, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `adjustDayItems` and `computePhantomEntry`**

```javascript
static adjustDayItems(nutrilistItems, multiplier) {
  if (!nutrilistItems?.length || multiplier === 1.0) return nutrilistItems;

  return nutrilistItems.map(item => {
    const scaled = { ...item };
    scaled.original_grams = item.grams;
    scaled.grams = Math.round(item.grams * multiplier);
    scaled.calories = Math.round((item.calories || 0) * multiplier);
    scaled.protein = Math.round((item.protein || 0) * multiplier);
    scaled.carbs = Math.round((item.carbs || 0) * multiplier);
    scaled.fat = Math.round((item.fat || 0) * multiplier);
    scaled.fiber = Math.round((item.fiber || 0) * multiplier);
    scaled.sugar = Math.round((item.sugar || 0) * multiplier);
    scaled.sodium = Math.round((item.sodium || 0) * multiplier);
    scaled.cholesterol = Math.round((item.cholesterol || 0) * multiplier);
    scaled.adjusted = true;
    return scaled;
  });
}

static computePhantomEntry(gapCalories, macroRatios) {
  if (!gapCalories || gapCalories <= 0) return null;

  const ratios = macroRatios || DEFAULT_MACRO_SPLIT;
  return {
    label: 'Estimated Untracked Intake',
    calories: Math.round(gapCalories),
    protein: Math.round((gapCalories * ratios.proteinRatio) / 4),
    carbs: Math.round((gapCalories * ratios.carbsRatio) / 4),
    fat: Math.round((gapCalories * ratios.fatRatio) / 9),
    phantom: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/CalorieAdjustmentService.mjs tests/unit/domains/health/CalorieAdjustmentService.test.mjs
git commit -m "feat(health): add item scaling and phantom entry generation"
```

---

### Task 3: Domain Service — Top-Level `adjustDay` Method

**Files:**
- Modify: `tests/unit/domains/health/CalorieAdjustmentService.test.mjs`
- Modify: `backend/src/2_domains/health/services/CalorieAdjustmentService.mjs`

- [ ] **Step 1: Write failing tests for `adjustDay`**

```javascript
describe('adjustDay', () => {
  const windowStats = { avgAccuracy: 0.75, stdDevAccuracy: 0.10 };

  it('scales items and adds metadata', () => {
    const items = [
      { label: 'Chicken', grams: 150, calories: 250, protein: 47, carbs: 0, fat: 5, color: 'yellow' },
    ];
    const recon = { tracking_accuracy: 0.75, implied_intake: 1500, tracked_calories: 1125 };
    const result = CalorieAdjustmentService.adjustDay(items, recon, windowStats);

    expect(result.adjustedItems[0].adjusted).toBe(true);
    expect(result.metadata.portion_multiplier).toBeCloseTo(1.33, 1);
    expect(result.phantomEntry).toBeNull(); // within max multiplier
  });

  it('caps multiplier and creates phantom for low accuracy days', () => {
    const items = [
      { label: 'Salad', grams: 200, calories: 100, protein: 5, carbs: 15, fat: 3, color: 'green' },
    ];
    const recon = { tracking_accuracy: 0.40, implied_intake: 1800, tracked_calories: 720 };
    const result = CalorieAdjustmentService.adjustDay(items, recon, windowStats);

    // max multiplier = 1/(0.75-0.10) = 1.54
    expect(result.metadata.portion_multiplier).toBeCloseTo(1.54, 1);
    expect(result.phantomEntry).not.toBeNull();
    expect(result.phantomEntry.phantom).toBe(true);
    // phantom = implied - (tracked * capped_multiplier) = 1800 - (720 * 1.54) = 1800 - 1109 = 691
    expect(result.phantomEntry.calories).toBeCloseTo(691, -1);
  });

  it('returns unmodified items when accuracy is 1.0', () => {
    const items = [{ label: 'Apple', grams: 180, calories: 95, protein: 0, carbs: 25, fat: 0 }];
    const recon = { tracking_accuracy: 1.0, implied_intake: 95, tracked_calories: 95 };
    const result = CalorieAdjustmentService.adjustDay(items, recon, windowStats);
    expect(result.adjustedItems[0].adjusted).toBeUndefined();
    expect(result.phantomEntry).toBeNull();
  });

  it('creates phantom-only when no items exist', () => {
    const recon = { tracking_accuracy: 0.0, implied_intake: 1500, tracked_calories: 0 };
    const result = CalorieAdjustmentService.adjustDay([], recon, windowStats);
    expect(result.adjustedItems).toEqual([]);
    expect(result.phantomEntry.calories).toBe(1500);
  });

  it('skips adjustment when tracking_accuracy is null', () => {
    const items = [{ label: 'Apple', grams: 180, calories: 95 }];
    const recon = { tracking_accuracy: null, implied_intake: -500, tracked_calories: 95 };
    const result = CalorieAdjustmentService.adjustDay(items, recon, windowStats);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `adjustDay`**

```javascript
static adjustDay(nutrilistItems, reconciliation, windowStats) {
  if (reconciliation.tracking_accuracy == null) return null;

  const { multiplier, maxMultiplier, phantomNeeded } = CalorieAdjustmentService.computePortionMultiplier(
    reconciliation.tracking_accuracy,
    windowStats.avgAccuracy,
    windowStats.stdDevAccuracy
  );

  const adjustedItems = CalorieAdjustmentService.adjustDayItems(nutrilistItems, multiplier);

  let phantomEntry = null;
  if (phantomNeeded || (nutrilistItems.length === 0 && reconciliation.implied_intake > 0)) {
    const scaledCalories = reconciliation.tracked_calories * multiplier;
    const gapCalories = reconciliation.implied_intake - scaledCalories;

    // Compute macro ratios from day's items
    const totalCal = nutrilistItems.reduce((s, i) => s + (i.calories || 0), 0);
    const macroRatios = totalCal > 0
      ? {
          proteinRatio: nutrilistItems.reduce((s, i) => s + (i.protein || 0) * 4, 0) / totalCal,
          carbsRatio: nutrilistItems.reduce((s, i) => s + (i.carbs || 0) * 4, 0) / totalCal,
          fatRatio: nutrilistItems.reduce((s, i) => s + (i.fat || 0) * 9, 0) / totalCal,
        }
      : null;

    phantomEntry = CalorieAdjustmentService.computePhantomEntry(gapCalories, macroRatios);
  }

  return {
    adjustedItems,
    phantomEntry,
    metadata: {
      portion_multiplier: multiplier,
      max_multiplier: maxMultiplier,
      phantom_calories: phantomEntry?.calories || 0,
      raw_calories: reconciliation.tracked_calories,
      tracking_accuracy: reconciliation.tracking_accuracy,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/CalorieAdjustmentService.mjs tests/unit/domains/health/CalorieAdjustmentService.test.mjs
git commit -m "feat(health): add top-level adjustDay method for calorie adjustment"
```

---

### Task 4: Persistence — INutritionItemsReader Port & Adjusted Nutriday

**Files:**
- Create: `backend/src/3_applications/health/ports/INutritionItemsReader.mjs`
- Modify: `backend/src/3_applications/health/ports/IHealthDataDatastore.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs`

- [ ] **Step 1: Create INutritionItemsReader port**

```javascript
/**
 * Read-only port for structured nutrition items by date.
 * Decouples health domain from nutribot's INutriListDatastore.
 */
export class INutritionItemsReader {
  async findByDateRange(userId, startDate, endDate) {
    throw new Error('Not implemented');
  }
}

export default INutritionItemsReader;
```

- [ ] **Step 2: Add adjusted nutrition methods to IHealthDataDatastore**

Add alongside existing methods:

```javascript
async loadAdjustedNutritionData(userId) {
  throw new Error('Not implemented');
}

async saveAdjustedNutritionData(userId, data) {
  throw new Error('Not implemented');
}
```

- [ ] **Step 3: Read YamlHealthDatastore to find existing patterns**

Read: `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs`
Find `#loadUserFile` / `#saveUserFile`.

- [ ] **Step 4: Implement adjusted nutriday in YamlHealthDatastore**

Add load/save using existing `#loadUserFile` / `#saveUserFile`:

```javascript
async loadAdjustedNutritionData(userId) {
  this.#logger.debug?.('health.store.loadAdjustedNutrition', { userId });
  return this.#loadUserFile(userId, 'lifelog/nutrition/nutriday_adjusted');
}

async saveAdjustedNutritionData(userId, data) {
  this.#logger.debug?.('health.store.saveAdjustedNutrition', { userId, dates: Object.keys(data).length });
  this.#saveUserFile(userId, 'lifelog/nutrition/nutriday_adjusted', data);
}
```

**IMPORTANT: Do NOT implement `findByDateRange` in YamlHealthDatastore.** The nutrilist data has a hot/cold archive split (items >30 days are in monthly archive files under `lifelog/nutrition/archives/nutrilist/{YYYY-MM}.yml`). `YamlNutriListDatastore` already handles this correctly via `findByDateRange`. Instead, the existing `YamlNutriListDatastore` instance will be used as the `nutritionItemsReader` — it already has the exact method signature needed. The `INutritionItemsReader` port just formalizes the interface boundary so health code doesn't depend on the nutribot port directly.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/ports/INutritionItemsReader.mjs backend/src/3_applications/health/ports/IHealthDataDatastore.mjs backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs
git commit -m "feat(health): add nutrition items reader port and adjusted nutriday persistence"
```

---

### Task 5: ReconciliationProcessor — Call Adjustment Service

**Files:**
- Modify: `backend/src/3_applications/health/ReconciliationProcessor.mjs`
- Create: `tests/unit/applications/health/ReconciliationProcessor.adjustment.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReconciliationProcessor from '#apps/health/ReconciliationProcessor.mjs';

describe('ReconciliationProcessor — adjustments', () => {
  let processor;
  let mockHealthStore;
  let mockNutritionItemsReader;

  beforeEach(() => {
    mockHealthStore = {
      loadWeightData: vi.fn().mockResolvedValue({
        '2026-03-16': { lbs_adjusted_average: 170, fat_percent_adjusted_average: 22 },
        '2026-03-17': { lbs_adjusted_average: 170.1, fat_percent_adjusted_average: 22 },
        '2026-03-18': { lbs_adjusted_average: 170.0, fat_percent_adjusted_average: 22 },
      }),
      loadNutritionData: vi.fn().mockResolvedValue({
        '2026-03-17': { calories: 1200 },
        '2026-03-18': { calories: 800 },
      }),
      loadFitnessData: vi.fn().mockResolvedValue({}),
      loadActivityData: vi.fn().mockResolvedValue({}),
      loadReconciliationData: vi.fn().mockResolvedValue({}),
      saveReconciliationData: vi.fn().mockResolvedValue(undefined),
      loadAdjustedNutritionData: vi.fn().mockResolvedValue({}),
      saveAdjustedNutritionData: vi.fn().mockResolvedValue(undefined),
    };

    mockNutritionItemsReader = {
      findByDateRange: vi.fn().mockResolvedValue([
        { label: 'Chicken', grams: 150, calories: 250, protein: 47, carbs: 0, fat: 5, date: '2026-03-17' },
        { label: 'Rice', grams: 200, calories: 230, protein: 4, carbs: 50, fat: 1, date: '2026-03-17' },
        { label: 'Apple', grams: 180, calories: 95, protein: 0, carbs: 25, fat: 0, date: '2026-03-18' },
      ]),
    };

    processor = new ReconciliationProcessor({
      healthStore: mockHealthStore,
      nutritionItemsReader: mockNutritionItemsReader,
    });
  });

  it('writes adjusted nutriday after reconciliation', async () => {
    await processor.process('kckern', { windowDays: 2, today: '2026-03-19' });
    expect(mockHealthStore.saveAdjustedNutritionData).toHaveBeenCalledOnce();
    const savedData = mockHealthStore.saveAdjustedNutritionData.mock.calls[0][1];
    expect(savedData['2026-03-17']).toBeDefined();
    expect(savedData['2026-03-17'].items).toBeDefined();
    expect(savedData['2026-03-17'].adjustment_metadata).toBeDefined();
  });

  it('skips adjustment when nutritionItemsReader is not provided', async () => {
    const noReaderProcessor = new ReconciliationProcessor({ healthStore: mockHealthStore });
    await noReaderProcessor.process('kckern', { windowDays: 2, today: '2026-03-19' });
    expect(mockHealthStore.saveAdjustedNutritionData).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Modify ReconciliationProcessor**

Add `nutritionItemsReader` to constructor:

```javascript
this.#nutritionItemsReader = config.nutritionItemsReader || null;
```

Add after `saveReconciliationData` call in `process()`:

```javascript
// Run calorie adjustment if nutrition items reader is available
if (this.#nutritionItemsReader && results.length > 0) {
  try {
    await this.#produceAdjustedNutrition(userId, results, windowDates);
  } catch (error) {
    this.#logger.error?.('reconciliation.adjustment.failed', {
      userId, error: error.message
    });
  }
}
```

Add private method:

```javascript
async #produceAdjustedNutrition(userId, reconciliationResults, windowDates) {
  const startDate = windowDates[0];
  const endDate = windowDates[windowDates.length - 1];

  const nutrilistItems = await this.#nutritionItemsReader.findByDateRange(userId, startDate, endDate);
  const existingAdjusted = await this.#healthStore.loadAdjustedNutritionData(userId);

  const windowStats = CalorieAdjustmentService.computeWindowStats(reconciliationResults);
  if (!windowStats.avgAccuracy) return;

  // Group nutrilist items by date
  const itemsByDate = {};
  for (const item of nutrilistItems) {
    if (!itemsByDate[item.date]) itemsByDate[item.date] = [];
    itemsByDate[item.date].push(item);
  }

  const adjusted = { ...existingAdjusted };
  for (const record of reconciliationResults) {
    const dayItems = itemsByDate[record.date] || [];
    const result = CalorieAdjustmentService.adjustDay(dayItems, record, windowStats);
    if (!result) continue;

    const allItems = [...result.adjustedItems];
    if (result.phantomEntry) allItems.push(result.phantomEntry);

    adjusted[record.date] = {
      calories: allItems.reduce((s, i) => s + (i.calories || 0), 0),
      protein: allItems.reduce((s, i) => s + (i.protein || 0), 0),
      carbs: allItems.reduce((s, i) => s + (i.carbs || 0), 0),
      fat: allItems.reduce((s, i) => s + (i.fat || 0), 0),
      fiber: allItems.reduce((s, i) => s + (i.fiber || 0), 0),
      sodium: allItems.reduce((s, i) => s + (i.sodium || 0), 0),
      sugar: allItems.reduce((s, i) => s + (i.sugar || 0), 0),
      cholesterol: allItems.reduce((s, i) => s + (i.cholesterol || 0), 0),
      items: allItems,
      adjustment_metadata: result.metadata,
    };
  }

  await this.#healthStore.saveAdjustedNutritionData(userId, adjusted);
}
```

Add import at top:

```javascript
import { CalorieAdjustmentService } from '#domains/health/services/CalorieAdjustmentService.mjs';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/applications/health/ReconciliationProcessor.adjustment.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/ReconciliationProcessor.mjs tests/unit/applications/health/ReconciliationProcessor.adjustment.test.mjs
git commit -m "feat(health): produce adjusted nutriday from reconciliation"
```

---

### Task 6: Real-Time Prompt Boost — LogFoodFromText & LogFoodFromImage

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs`
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs`
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs`

- [ ] **Step 1: Read LogFoodFromText prompt builder**

Read: `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs` lines 324-375
Identify where the system prompt ends.

- [ ] **Step 2: Add `reconciliationReader` dependency to both use cases**

In both `LogFoodFromText` and `LogFoodFromImage` constructors, add:

```javascript
this.#reconciliationReader = deps.reconciliationReader || null;
```

- [ ] **Step 3: Add prompt boost to LogFoodFromText**

`#buildDetectionPrompt` is synchronous — do NOT make it async. Instead, pre-fetch the boost string in `execute()` and pass it as a parameter.

In `execute()`, before the `#buildDetectionPrompt` call (around line 134), add:

```javascript
// Pre-fetch portion boost for AI prompt (non-fatal if unavailable)
let portionBoost = '';
if (this.#reconciliationReader) {
  try {
    const reconData = await this.#reconciliationReader();
    if (reconData?.avg_tracking_accuracy && reconData.avg_tracking_accuracy < 0.95) {
      const multiplier = (1 / reconData.avg_tracking_accuracy).toFixed(2);
      const accuracy = Math.round(reconData.avg_tracking_accuracy * 100);
      portionBoost = `\n\nIMPORTANT CALIBRATION: Historical data shows portion estimates are typically ${accuracy}% of actual weight. Multiply all gram estimates by ${multiplier}x. For example, if you would estimate 150g, report ${Math.round(150 * parseFloat(multiplier))}g instead.`;
    }
  } catch (e) {
    // Non-fatal — use uncalibrated estimates
  }
}
```

Then change the call from `this.#buildDetectionPrompt(text)` to `this.#buildDetectionPrompt(text, portionBoost)`.

In `#buildDetectionPrompt(userText, portionBoost = '')`, append `portionBoost` to the system message content string (before the closing backtick of the template literal).

- [ ] **Step 4: Add same boost to LogFoodFromImage**

Same pattern: pre-fetch in `execute()`, pass to `#buildDetectionPrompt(portionBoost)`.

For LogFoodFromImage, the system prompt currently says "Be conservative with estimates." When `portionBoost` is non-empty, replace that line with "Use the portion adjustment factor below to calibrate your gram estimates." This prevents conflicting instructions to the AI.

Change `#buildDetectionPrompt()` signature to `#buildDetectionPrompt(portionBoost = '')`.

- [ ] **Step 5: Update NutribotContainer to pass reconciliationReader**

In `NutribotContainer`, the `getLogFoodFromText()` and `getLogFoodFromImage()` lazy getters need `reconciliationReader` passed. This is a function that reads the latest reconciliation record:

```javascript
reconciliationReader: this.#reconciliationReader,
```

Add `reconciliationReader` to NutribotContainer constructor options:

```javascript
this.#reconciliationReader = options.reconciliationReader || null;
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs backend/src/3_applications/nutribot/NutribotContainer.mjs
git commit -m "feat(nutribot): inject portion multiplier into AI prompts from reconciliation data"
```

---

### Task 7: Health API — Return Adjusted Data

**Files:**
- Modify: `backend/src/2_domains/health/services/HealthAggregationService.mjs`
- Modify: `backend/src/3_applications/health/AggregateHealthUseCase.mjs`

- [ ] **Step 1: Read HealthAggregationService.aggregateDayMetrics**

Read: `backend/src/2_domains/health/services/HealthAggregationService.mjs` lines 42-90
Find where `nutritionData` is built and returned in the metric object.

- [ ] **Step 2: Add `adjustedNutrition` to aggregateDayMetrics**

Add a new `adjustedNutrition` parameter to the `sources` object accepted by `aggregateDayMetrics`:

```javascript
static aggregateDayMetrics(date, sources) {
  const { weight, strava, fitness, nutrition, coaching, adjustedNutrition } = sources;
  // ... existing code ...

  // After building nutritionData:
  const adjustedData = adjustedNutrition ? {
    calories: adjustedNutrition.calories,
    protein: adjustedNutrition.protein,
    carbs: adjustedNutrition.carbs,
    fat: adjustedNutrition.fat,
    fiber: adjustedNutrition.fiber,
    sodium: adjustedNutrition.sodium,
    sugar: adjustedNutrition.sugar,
    cholesterol: adjustedNutrition.cholesterol,
    portion_multiplier: adjustedNutrition.adjustment_metadata?.portion_multiplier,
    phantom_calories: adjustedNutrition.adjustment_metadata?.phantom_calories,
    tracking_accuracy: adjustedNutrition.adjustment_metadata?.tracking_accuracy,
  } : null;

  // In the return object, add adjusted to nutrition:
  nutrition: nutritionData ? { ...nutritionData, adjusted: adjustedData } : null,
```

- [ ] **Step 3: Update AggregateHealthUseCase to load adjusted data**

In `execute()`, add `loadAdjustedNutritionData` to the parallel load:

```javascript
const [weightData, activityData, fitnessData, nutritionData, existingHealth, coachingData, adjustedNutritionData] =
  await Promise.all([
    // ... existing loads ...
    this.#healthStore.loadAdjustedNutritionData(userId).catch(() => ({})),
  ]);
```

Pass to aggregator:

```javascript
const metric = HealthAggregator.aggregateDayMetrics(date, {
  // ... existing sources ...
  adjustedNutrition: adjustedNutritionData[date],
});
```

- [ ] **Step 4: Run existing health tests to verify no regression**

Run: `npx vitest run tests/unit/domains/health/ tests/unit/applications/health/`
Expected: PASS — adjusted field is additive, existing tests don't assert against it

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/HealthAggregationService.mjs backend/src/3_applications/health/AggregateHealthUseCase.mjs
git commit -m "feat(health): return adjusted nutrition data in health API response"
```

---

### Task 8: Bootstrap Wiring

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Read bootstrap.mjs health services section**

Read: `backend/src/0_system/bootstrap.mjs` lines 2328-2400
Find where ReconciliationProcessor and NutribotContainer are instantiated.

- [ ] **Step 2: Wire nutritionItemsReader into ReconciliationProcessor**

The existing `nutriListStore` (a `YamlNutriListDatastore` instance) already has `findByDateRange(userId, startDate, endDate)` with archive-aware logic. Pass it directly as the `nutritionItemsReader`:

```javascript
const reconciliationProcessor = new ReconciliationProcessor({
  healthStore,
  nutritionItemsReader: nutriListStore, // YamlNutriListDatastore implements INutritionItemsReader
  logger
});
```

Note: `nutriListStore` is already created in `createHealthServices()` (line ~2360). The `ReconciliationProcessor` is created after it (line ~2347), so the reference is available.

**IMPORTANT:** The `INutritionItemsReader` port uses `findByDateRange`, but `YamlNutriListDatastore` has `findByDateRange`. In `ReconciliationProcessor.#produceAdjustedNutrition`, call the method as `this.#nutritionItemsReader.findByDateRange(userId, startDate, endDate)` to match the existing method name. The `INutritionItemsReader` port interface should use `findByDateRange` as well (not `findByDateRange`) to align with the existing implementation.

- [ ] **Step 3: Wire reconciliationReader into NutribotContainer**

`createNutribotServices()` runs BEFORE `createHealthServices()` in bootstrap. The `healthStore` doesn't exist yet when `NutribotContainer` is created. Use a lazy closure:

```javascript
// In createHealthServices(), after healthStore is created:
// Store healthStore reference on the app-level services object so
// the reconciliationReader closure (created earlier) can access it lazily.
```

The cleanest approach: create the `reconciliationReader` as a lazy closure that captures a mutable reference, then assign the reference after `healthStore` is created.

In the top-level bootstrap orchestration (where both create functions are called):

```javascript
// Before createNutribotServices:
let _healthStore = null;
const reconciliationReader = async () => {
  if (!_healthStore) return null;
  try {
    const data = await _healthStore.loadReconciliationData(defaultUserId);
    const dates = Object.keys(data).sort();
    return dates.length > 0 ? data[dates[dates.length - 1]] : null;
  } catch { return null; }
};

// Pass to createNutribotServices:
const nutribotServices = createNutribotServices({ ..., reconciliationReader });

// In createHealthServices, after healthStore is created:
_healthStore = healthStore;
```

This way the closure captures `_healthStore` by reference — it's `null` during NutribotContainer construction (which is fine, the reader is never called during construction), and becomes live once `createHealthServices` runs.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run tests/unit/domains/health/ tests/unit/applications/health/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(health): wire adjustment dependencies into bootstrap"
```

---

### Task 9: Manual Verification

**Files:** None (verification only)

- [ ] **Step 1: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 2: Trigger health aggregation**

```bash
sleep 12 && curl -s http://localhost:3111/api/v1/health/daily?days=30
```

- [ ] **Step 3: Check adjusted nutriday output**

```bash
sudo docker exec daylight-station sh -c 'head -40 data/users/kckern/lifelog/nutrition/nutriday_adjusted.yml'
```

Verify: items have `adjusted: true` and `original_grams`, phantom entries have `phantom: true`, `adjustment_metadata` block is present.

- [ ] **Step 4: Check API response has adjusted block**

```bash
curl -s http://localhost:3111/api/v1/health/daily?days=3 | node -e "
  process.stdin.on('data', d => {
    const data = JSON.parse(d).data;
    for (const [date, m] of Object.entries(data)) {
      if (m.nutrition) console.log(date, 'raw:', m.nutrition.calories, 'adj:', m.nutrition.adjusted?.calories || 'none');
    }
  });
"
```

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run tests/unit/domains/health/ tests/unit/applications/health/
```

Expected: All tests pass.
