import { describe, it, expect } from 'vitest';
import { HealthOperations } from './HealthOperations.mjs';

// Task 5.5: `ObservationPairingService.recomputeEntry` explicitly nulls `microsSource`
// when it recomputes macros from a density level (a density estimate is not AI/catalog
// micronutrient data). That write reaches the store through
// `updateNutritionItem`'s field whitelist (`NUTRITION_UPDATE_FIELDS`) — without
// `microsSource` in that Set, the field is silently dropped before it ever reaches
// `nutritionItems.update`, and a stale 'ai'/'catalog' provenance from an earlier
// capture would outlive the numbers it described.
describe('HealthOperations.updateNutritionItem — microsSource whitelist (Task 5.5)', () => {
  it('lets microsSource through to the store, not just calories/macros', async () => {
    let updateCalledWith = null;
    const ops = new HealthOperations({
      healthData: {},
      nutritionItems: {
        findByUuid: async () => ({ uuid: 'entry-a', kind: 'item' }),
        update: async (username, id, changes) => {
          updateCalledWith = changes;
          return { uuid: id, ...changes };
        },
      },
      today: () => '2026-09-03',
      newId: () => 'x',
    });

    await ops.updateNutritionItem('kc', 'entry-a', {
      calories: 448, fat: 12.4, carbs: 56, protein: 28, microsSource: null,
    }, { ratify: false });

    expect(updateCalledWith).toMatchObject({ calories: 448, fat: 12.4, carbs: 56, protein: 28 });
    expect(updateCalledWith).toHaveProperty('microsSource', null);
  });
});
