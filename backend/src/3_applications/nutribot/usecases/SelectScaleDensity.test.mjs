// Task 5.5 — macro wiring for scale entries.
//
// Before this task `SelectScaleDensity` — the use case behind the "commit path" (both
// the manual Telegram density tap and `ObservationService`'s automatic quiet-commit)
// — wrote only `label` and a hand-rolled `calories = round(grams * kcal_per_g)`. The
// domain's `computeNutrition` (same arithmetic, plus fat/carb/protein grams from the
// SAME density row) had no production caller. This suite pins the wiring: real macro
// numbers, reconciled against the stored calories, `microsSource: null`, and an
// explicit "no fabrication without a density" boundary at the config layer (an unknown
// level is refused, not silently zeroed).
import { describe, it, expect, beforeEach } from 'vitest';
import { SelectScaleDensity } from './SelectScaleDensity.mjs';
import { createNutriLog } from '../nutriLogRecords.mjs';

/** Level 4 ("Mixed"), the SAME row `ObservationPairingService.test.mjs` uses for its
 *  reproduced 500 g gross / 180 g tare / density-L4 placement — 320 g net, 448 kcal,
 *  fat/carb/protein 12.4/56/28. Keeping the numbers identical lets the parity test
 *  below assert equality rather than re-deriving them. */
const SCALE_CONFIG = {
  densityLevels: [
    { level: 4, label: 'Mixed', emoji: '🍛', kcal_per_g: 1.4, macros: { fat_pct: 25, carb_pct: 50, protein_pct: 25 } },
  ],
};

function makeFoodLogStore(initial) {
  const byId = new Map([[initial.id, initial]]);
  return {
    findByUuid: async (id) => byId.get(id) || null,
    save: async (log) => { byId.set(log.id, log); return log; },
    _get: (id) => byId.get(id),
  };
}

function makeLog(grams, extra = {}) {
  return createNutriLog({
    userId: 'u1',
    conversationId: 'u1',
    items: [{ label: 'Unknown', grams, calories: 0, unit: 'g', amount: 1, color: 'yellow', ...extra }],
    metadata: { source: 'scale', scaleId: 'kitchen-1' },
    timezone: 'America/Los_Angeles',
    timestamp: new Date(),
  });
}

describe('SelectScaleDensity — macro wiring (Task 5.5)', () => {
  let foodLogStore, uc, log;

  beforeEach(() => {
    log = makeLog(320);
    foodLogStore = makeFoodLogStore(log);
    uc = new SelectScaleDensity({
      messagingGateway: { updateMessage: async () => {} },
      foodLogStore,
      scaleConfig: SCALE_CONFIG,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });
  });

  it('writes protein/carbs/fat via computeNutrition, reconciling against the rounded calories', async () => {
    const result = await uc.execute({ userId: 'u1', conversationId: 'u1', logUuid: log.id, level: 4 });

    expect(result.calories).toBe(448); // 320 g × 1.4 kcal/g

    const item = foodLogStore._get(log.id).items[0];
    expect(item.calories).toBe(448);
    expect(item.protein).toBe(28);
    expect(item.carbs).toBe(56);
    expect(item.fat).toBe(12.4);

    // The reconciliation invariant `ScanNutritionService` exists to guarantee: the
    // stored macro grams burn back to the stored calorie total.
    expect(Math.round(item.fat * 9 + item.carbs * 4 + item.protein * 4)).toBe(item.calories);
  });

  it('sets microsSource to null — a density estimate is not micronutrient data', async () => {
    // Seed item0 with a non-null microsSource, as if an earlier AI capture had
    // attributed micros before the scale re-described the same row: the commit must
    // overwrite it, not inherit it.
    log = makeLog(320, { microsSource: 'ai' });
    foodLogStore = makeFoodLogStore(log);
    uc = new SelectScaleDensity({
      messagingGateway: { updateMessage: async () => {} },
      foodLogStore,
      scaleConfig: SCALE_CONFIG,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });

    await uc.execute({ userId: 'u1', conversationId: 'u1', logUuid: log.id, level: 4 });

    expect(foodLogStore._get(log.id).items[0].microsSource).toBeNull();
  });

  it('does not disturb the settled field — that stamp belongs to a later step in the commit flow', async () => {
    log = makeLog(320, { settled: true });
    foodLogStore = makeFoodLogStore(log);
    uc = new SelectScaleDensity({
      messagingGateway: { updateMessage: async () => {} },
      foodLogStore,
      scaleConfig: SCALE_CONFIG,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });

    await uc.execute({ userId: 'u1', conversationId: 'u1', logUuid: log.id, level: 4 });

    // Written verbatim, neither invented nor dropped by this use case.
    expect(foodLogStore._get(log.id).items[0].settled).toBe(true);
  });

  it('an unknown density level is refused outright — no fabricated macros, nothing written', async () => {
    await expect(
      uc.execute({ userId: 'u1', conversationId: 'u1', logUuid: log.id, level: 99 }),
    ).rejects.toMatchObject({ code: 'NUTRIBOT_SCALE_UNKNOWN_LEVEL' });

    const item = foodLogStore._get(log.id).items[0];
    expect(item.calories).toBe(0);
    expect(item.protein).toBe(0);
    expect(item.carbs).toBe(0);
    expect(item.fat).toBe(0);
  });
});
