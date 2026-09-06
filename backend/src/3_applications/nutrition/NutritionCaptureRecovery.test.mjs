import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NutritionCaptureRecovery } from './NutritionCaptureRecovery.mjs';
import { FoodLogReview, nutritionLogVersion } from './FoodLogReview.mjs';
import { YamlFoodLogDatastore } from '#adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlObservationStore } from '#adapters/persistence/yaml/YamlObservationStore.mjs';
import { createNutriLog } from '#apps/nutribot/nutriLogRecords.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

async function fixture(source = 'scale') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-recovery-'));
  const dataService = { user: { resolveDir: (relative, id) => path.join(root, id, relative) } };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const foodLogs = new YamlFoodLogDatastore({ configService: { getUserDir: id => path.join(root, id) }, logger });
  const items = new YamlNutriListDatastore({ dataService, logger });
  const observations = new YamlObservationStore({ dataService, logger });
  const review = new FoodLogReview({ foodLogs, items, logger });
  const recovery = new NutritionCaptureRecovery({ review, items, observations, scaleConfig: () => normalizeScaleNutribotConfig({}) });
  const log = createNutriLog({ userId: 'fixture', timezone: 'America/Los_Angeles', timestamp: new Date('2026-09-05T21:28:14Z'),
    metadata: source === 'scale' ? { source: 'scale', scaleId: 'kitchen', grossGrams: 458 }
      : { source: 'telegram', sourceUpc: 'yogurt' },
    items: [{ label: source === 'scale' ? 'Unknown' : 'Yogurt', grams: source === 'scale' ? 458 : null, amount: 1, unit: 'g',
      calories: source === 'scale' ? 0 : 160, icon: 'default', color: 'yellow' }] });
  await foodLogs.save(log);
  const observationIds = source === 'scale' ? [
    observations.append('fixture', { kind: 'weight', value: 458, unit: 'g', scaleId: 'kitchen', at: '2026-09-05 14:28:15' }).id,
    observations.append('fixture', { kind: 'density', value: 4, scaleId: 'kitchen', at: '2026-09-05 14:28:22' }).id,
  ] : [];
  for (const id of observationIds) observations.update('fixture', id, { status: 'dismissed' });
  return { recovery, observations, items, foodLogs, log,
    input: { userId: 'fixture', logUuid: log.id, expectedVersion: nutritionLogVersion(log), operationId: 'incident', observationIds } };
}

describe('explicit legacy capture recovery', () => {
  it('previews without writing, preserves original IDs/deadline, and replays a failed observation link', async () => {
    const f = await fixture();
    const preview = await f.recovery.recover(f.input);
    expect(preview.receipt.after[0]).toMatchObject({ uuid: f.log.items[0].uuid, calories: 641,
      captureEvidence: { tareGrams: null, weightBasis: 'gross-assumed-net' },
      review: { startedAt: '2026-09-05T21:28:14.000Z', stabilizesAt: '2026-09-08T21:28:14.000Z' } });
    expect(await f.items.findByDate('fixture', '2026-09-05')).toHaveLength(0);
    expect(nutritionLogVersion(await f.foodLogs.findById('fixture', f.log.id))).toBe(f.input.expectedVersion);
    vi.spyOn(f.observations, 'updateMany').mockImplementationOnce(() => { throw new Error('link failed'); });
    await expect(f.recovery.recover({ ...f.input, dryRun: false })).rejects.toThrow('link failed');
    await f.recovery.recover({ ...f.input, dryRun: false });
    expect(await f.items.findByDate('fixture', '2026-09-05')).toHaveLength(1);
    expect(f.observations.get('fixture', f.input.observationIds[0]).pairedEntryUuid).toBe(f.log.items[0].uuid);
    await f.recovery.recover({ ...f.input, dryRun: false });
    expect(await f.items.findByDate('fixture', '2026-09-05')).toHaveLength(1);
  });
  it('restores a UPC as one provisional serving with unknown micros, not a confirmed one-gram serving', async () => {
    const f = await fixture('upc');
    await f.recovery.recover({ ...f.input, dryRun: false });
    expect((await f.items.findByDate('fixture', '2026-09-05'))[0]).toMatchObject({ calories: 160, grams: null, amount: 1,
      unit: 'serving', settled: false, sugar: null, captureEvidence: { assumption: 'one-serving' } });
  });
  it('rejects stale versions and unrelated evidence without changing anything', async () => {
    const f = await fixture();
    await expect(f.recovery.recover({ ...f.input, expectedVersion: 'stale', dryRun: false })).rejects.toThrow('changed');
    f.observations.update('fixture', f.input.observationIds[0], { status: 'consumed', pairedEntryUuid: 'another-food' });
    await expect(f.recovery.recover({ ...f.input, dryRun: false })).rejects.toThrow('unclaimed');
    expect(await f.items.findByDate('fixture', '2026-09-05')).toHaveLength(0);
  });
});
