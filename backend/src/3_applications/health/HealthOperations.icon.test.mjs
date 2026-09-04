import { describe, it, expect } from 'vitest';
import { HealthOperations } from './HealthOperations.mjs';

// Task 7.4: the edit sheet's "just this entry" icon override travels through
// `updateNutritionItem`'s field whitelist (NUTRITION_UPDATE_FIELDS). A field
// missing from that Set is dropped SILENTLY — the request 200s, the sheet
// closes, and the icon is unchanged — so a whitelist entry is only worth
// anything if something drives it. Deleting 'icon' from the Set fails this.
describe('HealthOperations.updateNutritionItem — icon whitelist', () => {
  function ops(capture) {
    return new HealthOperations({
      healthData: {},
      nutritionItems: {
        findByUuid: async () => ({ uuid: 'entry-a', kind: 'item' }),
        update: async (username, id, changes) => { capture.changes = changes; return { uuid: id, ...changes }; },
      },
      today: () => '2026-09-03',
      newId: () => 'x',
    });
  }

  it('lets an icon through to the store', async () => {
    const capture = {};
    await ops(capture).updateNutritionItem('kc', 'entry-a', { icon: 'fried-eggs' });
    expect(capture.changes).toHaveProperty('icon', 'fried-eggs');
  });

  it('lets a null icon through, so clearing back to the neutral glyph really clears', async () => {
    const capture = {};
    await ops(capture).updateNutritionItem('kc', 'entry-a', { icon: null });
    expect(capture.changes).toHaveProperty('icon', null);
  });
});
