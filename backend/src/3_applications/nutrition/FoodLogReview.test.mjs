import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FoodLogReview, nutritionLogVersion } from './FoodLogReview.mjs';
import { createNutriLog } from '#apps/nutribot/nutriLogRecords.mjs';
import { YamlFoodLogDatastore } from '#adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { groupParsedItems } from '#domains/nutrition/services/groupParsedItems.mjs';
import { serializeFoodItem } from '#shared/contracts/nutrition/foodItemRecord.mjs';
import { NutribotContainer } from '#apps/nutribot/NutribotContainer.mjs';

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-review-'));
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  const foodLogs = new YamlFoodLogDatastore({ configService: { getUserDir: id => path.join(root, id) }, logger });
  const items = new YamlNutriListDatastore({ dataService: { user: { resolveDir: (relative, id) => path.join(root, id, relative) } }, logger });
  const makeReview = () => new FoodLogReview({ foodLogs, items, logger });
  const log = createNutriLog({ userId: 'alice', conversationId: 'device:alice',
    meal: { date: '2026-09-04', time: 'afternoon' }, metadata: { source: 'upc', sourceUpc: 'test', nutritionLookup: { source: 'fixture', warnings: [], missing: [] } },
    items: [{ id: 'shake00001', label: 'Shake', grams: null, unit: 'ml', amount: 325, icon: 'default', color: 'green',
      calories: 160, protein: 30, carbs: 4, fat: 3, fiber: 2, sugar: 1, sodium: 200, cholesterol: 10 }],
    timezone: 'America/Los_Angeles', timestamp: new Date('2026-09-04T19:00:00Z') });
  await foodLogs.save(log);
  return { root, foodLogs, items, log, makeReview, review: makeReview(), logger };
}
describe('shared pending food review', () => {
  it('requires label acknowledgement for legacy barcode imports without changing their estimates', async () => {
    const f = await fixture();
    await f.foodLogs.save(f.log.with({ metadata: { source: 'upc' } }, new Date()));
    const command = { userId: 'alice', logUuid: f.log.id, operationId: 'legacy' };
    await expect(f.review.execute(command)).rejects.toThrow('nutrition warning');
    expect(await f.items.findByDate('alice', '2026-09-04')).toHaveLength(0);
    await f.review.execute({ ...command, nutritionReviewed: true });
    expect((await f.items.findByDate('alice', '2026-09-04'))[0].calories).toBe(160);
  });
  it('confirms without messaging and scales every nutrient without inventing mass', async () => {
    const f = await fixture();
    const command = { userId: 'alice', logUuid: f.log.id, expectedVersion: nutritionLogVersion(f.log), operationId: 'one', portionFactor: 0.5 };
    await f.review.execute(command);
    await f.review.execute(command);
    const rows = await f.items.findByDate('alice', '2026-09-04');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ calories: 80, protein: 15, carbs: 2, fat: 1.5, fiber: 1, sugar: 0.5, sodium: 100, cholesterol: 5, grams: null, amount: 162.5 });
    expect((await f.foodLogs.findById('alice', f.log.id)).status).toBe('accepted');
  });
  it('resumes a failed ledger append after restart', async () => {
    const f = await fixture();
    const save = vi.spyOn(f.items, 'saveMany').mockRejectedValueOnce(new Error('disk unavailable'));
    const input = { userId: 'alice', logUuid: f.log.id, operationId: 'retry', portionFactor: 0.5 };
    await expect(f.review.execute(input)).rejects.toThrow('disk unavailable');
    expect((await f.foodLogs.findById('alice', f.log.id)).status).toBe('pending');
    await f.makeReview().execute(input);
    expect(save).toHaveBeenCalledTimes(2);
    expect((await f.items.findByDate('alice', '2026-09-04'))[0].calories).toBe(80);
  });
  it('recovers after ledger success but final capture write failure without duplicates', async () => {
    const f = await fixture();
    const original = f.foodLogs.save.bind(f.foodLogs);
    vi.spyOn(f.foodLogs, 'save').mockImplementationOnce(original).mockRejectedValueOnce(new Error('capture write failed')).mockImplementation(original);
    const input = { userId: 'alice', logUuid: f.log.id, operationId: 'retry' };
    await expect(f.review.execute(input)).rejects.toThrow('capture write failed');
    await f.makeReview().execute(input);
    expect(await f.items.findByDate('alice', '2026-09-04')).toHaveLength(1);
  });
  it('serializes competing app and Telegram confirmations', async () => {
    const f = await fixture();
    const input = { userId: 'alice', logUuid: f.log.id, expectedVersion: nutritionLogVersion(f.log) };
    const results = await Promise.allSettled([
      f.review.execute({ ...input, operationId: 'app', portionFactor: 0.5 }),
      f.review.execute({ ...input, operationId: 'telegram', portionFactor: 2 }),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await f.items.findByDate('alice', '2026-09-04'))[0].calories).toBe(80);
  });
  it('offers all review actions through a container with no Telegram gateway', async () => {
    const f = await fixture();
    const container = new NutribotContainer({}, { foodLogStore: f.foodLogs, nutriListStore: f.items, logger: f.logger });
    expect(container.getMessagingGateway().available).toBe(false);
    await container.getSelectUPCPortion().execute({ userId: 'alice', logUuid: f.log.id, portionFactor: 0.5 });
    expect((await f.items.findByDate('alice', '2026-09-04'))[0].calories).toBe(80);
  });
  it('preserves group/lifecycle metadata through YAML and acceptance', async () => {
    const f = await fixture();
    const raw = groupParsedItems([
      { id: 'tortilla01', dish: 'Fish Taco', label: 'Tortilla', icon: 'default', grams: 50, unit: 'g', amount: 50, color: 'yellow', calories: 145, settled: false, microsSource: 'ai' },
      { id: 'fish000001', dish: 'Fish Taco', label: 'White Fish', icon: 'default', grams: 55, unit: 'g', amount: 55, color: 'green', calories: 52, settled: false },
    ], { makeId: () => 'taco000001' });
    const log = createNutriLog({ userId: 'alice', meal: f.log.meal, items: raw, timestamp: new Date(), timezone: f.log.timezone });
    await f.foodLogs.save(log);
    const reloaded = await f.foodLogs.findById('alice', log.id);
    expect(reloaded.items.map(serializeFoodItem)).toEqual(log.items.map(serializeFoodItem));
    await f.review.execute({ userId: 'alice', logUuid: log.id });
    const rows = await f.items.findByDate('alice', '2026-09-04');
    expect(rows.find(row => row.id === 'taco000001')).toMatchObject({ kind: 'group', calories: 0, grams: 105 });
    expect(rows.find(row => row.id === 'fish000001')).toMatchObject({ parentId: 'taco000001', settled: false });
    expect(rows.reduce((sum, row) => sum + row.calories, 0)).toBe(197);
  });
  it('rejects stale edits and reused operation IDs without altering food', async () => {
    const f = await fixture();
    const input = { userId: 'alice', logUuid: f.log.id, action: 'save', expectedVersion: nutritionLogVersion(f.log), operationId: 'save', items: [{ id: 'shake00001', calories: 155 }] };
    await f.review.execute(input);
    await expect(f.review.execute({ ...input, operationId: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(f.review.execute({ ...input, items: [] })).rejects.toMatchObject({ status: 409 });
    expect(await f.items.findByDate('alice', '2026-09-04')).toHaveLength(0);
  });
});
