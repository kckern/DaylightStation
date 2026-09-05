// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NutritionEvidenceToolFactory } from './NutritionEvidenceToolFactory.mjs';

function fixture(rows) {
  const deps = {
    items: { findByDateRange: vi.fn(async () => Array.from({ length: 35 }, (_, id) => ({ id, name: 'Shake', date: '2010-01-01' }))) },
    foodLogs: { findById: vi.fn(async () => ({ id: 'capture', metadata: { sourceUpc: '123456789012', nutritionLookup: {} } })) },
    upc: { lookup: vi.fn(async () => ({ serving: { size: 100, unit: 'ml' }, nutrition: { calories: 50 }, nutritionLookup: { warnings: [] } })) },
    clock: { now: () => 0 },
  };
  const tools = new NutritionEvidenceToolFactory(deps).createTools({ userId: 'alice', snapshot: { rows, pending: [] },
    remember: (kind, data, facts = []) => ({ kind, data, facts }) });
  return { ...deps, tool: name => tools.find(tool => tool.name === name) };
}
describe('read-only nutrition evidence tools', () => {
  it('searches old history with pagination and binds the trusted owner', async () => {
    const f = fixture([]);
    const result = await f.tool('search_food_history').execute({ query: 'shake', offset: 30, userId: 'bob' });
    expect(f.items.findByDateRange).toHaveBeenCalledWith('alice', '0001-01-01', '9999-12-31');
    expect(result.data).toMatchObject({ total: 35, nextOffset: null });
    expect(result.data.rows).toHaveLength(5);
  });
  it('grants exact serving facts only for a single matching captured food', async () => {
    const row = { uuid: 'shake', logUuid: 'capture', amount: 200, unit: 'ml' };
    const f = fixture([row]);
    const result = await f.tool('lookup_barcode_product').execute({ logId: 'capture' });
    expect(result.facts).toEqual([{ entryId: 'shake', field: 'calories', value: 100 }]);
    expect(f.upc.lookup).toHaveBeenCalledWith('123456789012');
    const split = fixture([row, { ...row, uuid: 'other' }]);
    expect((await split.tool('lookup_barcode_product').execute({ logId: 'capture' })).facts).toEqual([]);
    const differentUnit = fixture([{ ...row, unit: 'g' }]);
    expect((await differentUnit.tool('lookup_barcode_product').execute({ logId: 'capture' })).facts).toEqual([]);
  });
});
