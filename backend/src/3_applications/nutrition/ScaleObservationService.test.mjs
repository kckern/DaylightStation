import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createObservationService } from './ScaleObservationService.mjs';
import { FoodLogReview } from './FoodLogReview.mjs';
import { YamlFoodLogDatastore } from '#adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlObservationStore } from '#adapters/persistence/yaml/YamlObservationStore.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { LogFoodFromUPC } from '#apps/nutribot/usecases/LogFoodFromUPC.mjs';
import { NutritionStabilization } from './NutritionStabilization.mjs';

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-capture-'));
  let time = Date.parse('2026-09-05T19:48:16Z');
  const clock = { now: () => time };
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const dataService = { user: { resolveDir: (relative, id) => path.join(root, id, relative) } };
  const foodLogs = new YamlFoodLogDatastore({ configService: { getUserDir: id => path.join(root, id) }, logger });
  const items = new YamlNutriListDatastore({ dataService, logger });
  const observations = new YamlObservationStore({ dataService, logger });
  const review = new FoodLogReview({ foodLogs, items, logger, clock });
  const scaleConfig = normalizeScaleNutribotConfig({ nutribot: { containers: { items: [{ id: 'tupperware', grams: 60 }] } } });
  const timers = new Map(); let tid = 0; let listener;
  const scheduler = { setTimeout: fn => { timers.set(++tid, fn); return tid; }, clearTimeout: id => timers.delete(id) };
  const make = () => createObservationService({ scaleGateway: { subscribe: fn => { listener = fn; return () => {}; } },
    observationStore: observations, foodLogStore: foodLogs, nutribotContainer: { getFoodLogReview: () => review },
    userId: 'alice', scaleConfig, timezone: 'America/Los_Angeles', clock: () => new Date(time), scheduler, logger });
  const service = make(); await service.ready;
  const publish = grams => listener({ id: 'kitchen', grams, unit: 'g', stable: true });
  await publish(0);
  return { service, make, publish, foodLogs, items, observations, review, clock, logger,
    advance: ms => { time += ms; },
    fire: async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await service.settled(); },
    rows: () => items.findByDate('alice', '2026-09-05') };
}

describe('durable provisional scale capture', () => {
  it.each(['wdc', 'wcd', 'dwc', 'dcw', 'cwd', 'cdw'])('reconciles weight, density and container in order %s into one entry', async order => {
    const f = await fixture();
    for (const kind of order) {
      if (kind === 'w') await f.publish(458);
      if (kind === 'd') f.service.setDensity('kitchen', 4);
      if (kind === 'c') f.service.setContainer('kitchen', 'tupperware');
      await f.service.settled();
    }
    expect(await f.rows()).toHaveLength(1);
    expect((await f.rows())[0]).toMatchObject({ grams: 398, calories: 557, settled: false });
    f.service.dispose();
  });
  it('attaches a QR arriving after removal to the closed placement, not a duplicate', async () => {
    const f = await fixture();
    await f.publish(458); await f.publish(0);
    f.advance(7000); f.service.setDensity('kitchen', 4); await f.service.settled();
    expect(await f.rows()).toHaveLength(1);
    expect((await f.rows())[0].calories).toBe(641);
    await f.fire();
    expect(await f.rows()).toHaveLength(1);
    f.service.dispose();
  });
  it('does not resurrect an explicitly cleared placement on held frames or restart', async () => {
    const f = await fixture();
    await f.publish(458); f.service.setDensity('kitchen', 4); await f.service.settled();
    f.service.clear('kitchen'); await f.service.settled(); await f.publish(458);
    expect(await f.rows()).toHaveLength(0);
    f.service.dispose();
    const restored = f.make(); await restored.ready; await f.publish(458);
    expect(await f.rows()).toHaveLength(0);
    restored.dispose();
  });
  it('recovers a failed observation link after the ledger was successfully written', async () => {
    const f = await fixture();
    await f.publish(458);
    vi.spyOn(f.observations, 'updateMany').mockImplementationOnce(() => { throw new Error('link write failed'); });
    f.service.setDensity('kitchen', 4);
    await expect(f.service.settled()).rejects.toThrow('link write failed');
    expect(await f.rows()).toHaveLength(1);
    f.service.dispose();
    const restored = f.make(); await restored.ready;
    expect(await f.rows()).toHaveLength(1);
    const rows = f.observations.findByPlacement('alice', (await f.rows())[0].uuid);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.status === 'consumed')).toBe(true);
    restored.dispose();
  });
  it('persists stabilization at exactly 72 hours, even after downtime, without changing totals', async () => {
    const f = await fixture();
    await f.publish(458); f.service.setDensity('kitchen', 4); await f.service.settled();
    const worker = new NutritionStabilization({ items: f.items, review: f.review, clock: f.clock, logger: f.logger });
    f.advance(72 * 3600000 - 1);
    expect(await worker.run('alice')).toBe(0);
    f.advance(1);
    expect(await worker.run('alice')).toBe(1);
    expect((await f.rows())[0]).toMatchObject({ calories: 641, settled: true, settledBy: 'auto', review: { state: 'stable' } });
    f.advance(7 * 86400000);
    expect(await new NutritionStabilization({ items: f.items, review: f.review, clock: f.clock, logger: f.logger }).run('alice')).toBe(0);
    f.service.dispose();
  });
  it('replays yogurt + chia + 458g at 140 kcal/100g as three counted entries without messaging', async () => {
    const f = await fixture();
    const gateway = { sendMessage: vi.fn(() => { throw new Error('Telegram unavailable'); }) };
    const uc = new LogFoodFromUPC({ messagingGateway: gateway, foodLogStore: f.foodLogs,
      reviewService: f.review, logger: f.logger, config: { getUserTimezone: () => 'America/Los_Angeles' },
      upcGateway: { lookup: async upc => ({ name: upc === 'yogurt' ? 'Oikos yogurt' : 'Chia seeds',
        serving: upc === 'yogurt' ? { size: 1, unit: 'serving' } : { size: 14, unit: 'g' },
        nutrition: { calories: upc === 'yogurt' ? 160 : 70 },
        nutritionLookup: { source: 'fixture', warnings: ['Portion estimate'], missing: ['sugar'] } }) } });
    const yogurt = { userId: 'alice', conversationId: 'device:alice', headless: true, upc: 'yogurt', date: '2026-09-05', operationId: 'scan-yogurt' };
    await Promise.all([uc.execute(yogurt), uc.execute(yogurt)]);
    await uc.execute(yogurt);
    await uc.execute({ userId: 'alice', conversationId: 'device:alice', headless: true, upc: 'chia', date: '2026-09-05' });
    f.advance(100 * 60000);
    await f.publish(458);
    f.advance(7000);
    f.service.setDensity('kitchen', 4);
    // Normal removal occurs before the 25-second quiet deadline.
    await f.publish(0);
    await f.service.settled();
    const rows = await f.rows();
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.calories)).toEqual([160, 70, 641]);
    expect(rows.every(row => row.settled === false && row.review.state === 'provisional')).toBe(true);
    expect(rows[1]).toMatchObject({ grams: 14, amount: 14, unit: 'g', sugar: null });
    expect(rows[2]).toMatchObject({ grams: 458, captureEvidence: { grossGrams: 458, tareGrams: null, weightBasis: 'gross-assumed-net' } });
    expect(gateway.sendMessage).not.toHaveBeenCalled();
    f.service.dispose();
  });
  it('updates the same counted entry when tare and weight arrive later, protecting user corrections', async () => {
    const f = await fixture();
    await f.publish(639);
    f.service.setDensity('kitchen', 4); await f.service.settled();
    const first = (await f.rows())[0];
    f.advance(4400);
    f.service.setContainer('kitchen', 'tupperware');
    await f.publish(473); await f.service.settled();
    expect(await f.rows()).toHaveLength(1);
    expect((await f.rows())[0]).toMatchObject({ uuid: first.uuid, grams: 413, calories: 578 });
    await f.review.execute({ userId: 'alice', logUuid: first.logId, action: 'confirm' });
    await f.publish(500);
    expect((await f.rows())[0]).toMatchObject({ grams: 413, calories: 578, settledBy: 'user' });
    f.service.dispose();
  });
  it('recovers an interrupted ledger write without losing a held placement or duplicating it', async () => {
    const f = await fixture();
    await f.publish(458);
    const save = vi.spyOn(f.items, 'saveMany').mockRejectedValueOnce(new Error('disk temporarily unavailable'));
    f.service.setDensity('kitchen', 4);
    await expect(f.service.settled()).rejects.toThrow('disk temporarily unavailable');
    f.service.dispose();
    const recovered = f.make(); await recovered.ready;
    await f.publish(458); await recovered.settled();
    expect(save).toHaveBeenCalledTimes(2);
    expect(await f.rows()).toHaveLength(1);
    expect((await f.rows())[0].calories).toBe(641);
    await f.publish(0); await f.publish(100); await recovered.settled();
    expect(recovered.read('kitchen').density).toBeNull();
    expect(await f.rows()).toHaveLength(1);
    recovered.dispose();
  });
  it('never multiplies a volume by a gram density', async () => {
    const f = await fixture();
    f.service.setWeight('kitchen', { grams: 458, unit: 'ml' });
    f.service.setDensity('kitchen', 4); await f.service.settled();
    expect(await f.rows()).toHaveLength(0);
    expect(f.service.read('kitchen').observationIds).toHaveLength(2);
    f.service.dispose();
  });
  it('retains the best counted estimate when a later container code cannot be resolved', async () => {
    const f = await fixture();
    await f.publish(458); f.service.setDensity('kitchen', 4); await f.service.settled();
    f.service.setContainer('kitchen', 'missing-container'); await f.service.settled();
    expect((await f.rows())[0]).toMatchObject({ grams: 458, calories: 641, settled: false });
    expect((await f.rows())[0].captureEvidence.assumptions).toContain('Scanned tare could not be applied.');
    f.service.dispose();
  });
});
