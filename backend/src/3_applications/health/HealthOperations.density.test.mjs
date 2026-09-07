import { describe, expect, it } from 'vitest';
import { HealthOperations } from './HealthOperations.mjs';
import { densityRevision } from '#shared-contracts/health/foodDensity.mjs';

describe('HealthOperations density context', () => {
  it('reads the configuration thunk once per context call and reflects reloads', () => {
    const first = [{ level: 1, label: 'First', emoji: '1', hint: 'a', kcal_per_g: 0.2, macros: { protein_pct: 30, carb_pct: 60, fat_pct: 10 } }];
    const second = [{ level: 1, label: 'Second', emoji: '2', hint: 'b', kcal_per_g: 0.3, macros: { protein_pct: 20, carb_pct: 50, fat_pct: 30 } }];
    const values = [first, second];
    let calls = 0;
    const operations = new HealthOperations({
      healthData: {},
      resolveDefaultUsername: () => 'fixture',
      densityLevels: () => values[calls++],
    });

    expect(operations.context()).toEqual({
      userId: 'fixture', densityLevels: first, densityRevision: densityRevision(first),
    });
    expect(calls).toBe(1);
    expect(operations.context()).toEqual({
      userId: 'fixture', densityLevels: second, densityRevision: densityRevision(second),
    });
    expect(calls).toBe(2);
  });
});
