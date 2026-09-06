import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlFoodLogDatastore } from '#adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlNutritionSurfaceCheckpoints } from '#adapters/persistence/yaml/YamlNutritionSurfaceCheckpoints.mjs';
import { NutritionReceiptRenderer } from '#rendering/nutribot/NutritionReceiptRenderer.mjs';
import { LogFoodFromUPC } from '#apps/nutribot/usecases/LogFoodFromUPC.mjs';
import { FoodLogReview } from './FoodLogReview.mjs';
import { ScaleCapture } from './ScaleCapture.mjs';
import { NutritionRepairService } from './NutritionRepairService.mjs';
import { NutritionStabilization } from './NutritionStabilization.mjs';
import { NutritionReceiptPublisher } from './NutritionReceiptPublisher.mjs';
import { HealthOperations } from '#apps/health/HealthOperations.mjs';

describe('mutable nutrition receipts with the real capture/reviewer/Health ledger', () => {
  it('replays yogurt + chia + scale, late evidence, guarded review, manual edit, restart and stabilization', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-receipt-lifecycle-'));
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const userId = 'alice', conversationId = 'telegram:alice';
    let now = Date.parse('2026-09-05T19:48:18Z');
    const clock = { now: () => now };
    const dataService = { user: { resolveDir: (relative, owner) => path.join(root, owner, relative) } };
    const makeLogs = () => new YamlFoodLogDatastore({ configService: { getUserDir: owner => path.join(root, owner) }, logger });
    const makeItems = () => new YamlNutriListDatastore({ dataService, logger });
    let foodLogs = makeLogs(), items = makeItems();
    let review = new FoodLogReview({ foodLogs, items, logger, clock });
    const delivered = new Map();
    const updateMessage = vi.fn(async (_, binding, receipt) => { delivered.set(binding.messageId, receipt); });
    const publisherDeps = () => ({ foodLogs, items, logger,
      destinationFor: () => conversationId,
      linkFor: log => log.metadata.messageId ? { messageId: log.metadata.messageId, caption: log.metadata.messageKind === 'photo' } : null,
      checkpoints: new YamlNutritionSurfaceCheckpoints({ dataService }), renderer: new NutritionReceiptRenderer(),
      surface: { updateMessage },
    });
    let publisher = new NutritionReceiptPublisher(publisherDeps());
    await publisher.publish(userId);
    let sequence = 20;
    const gateway = { sendMessage: vi.fn(async () => ({ messageId: String(++sequence) })), deleteMessage: vi.fn(), updateMessage: vi.fn() };
    const products = {
      '036632042590': { name: 'Yogurt', serving: { size: 1, unit: 'serving' }, nutrition: { calories: 160, protein: 25, carbs: 6, fat: 3.5 } },
      '605100002512': { name: 'Chia Seeds', serving: { size: 14, unit: 'g' }, nutrition: { calories: 70, protein: 3, carbs: 4.5, fat: 4 } },
    };
    const capture = new LogFoodFromUPC({ messagingGateway: gateway, foodLogStore: foodLogs, reviewService: review,
      receipts: () => publisher, upcGateway: { lookup: async upc => products[upc] }, clock, logger });
    const yogurt = await capture.execute({ userId, conversationId, upc: '036632042590', operationId: 'scan-yogurt' });
    now += 3000;
    const chia = await capture.execute({ userId, conversationId, upc: '605100002512', operationId: 'scan-chia' });
    expect(gateway.sendMessage).toHaveBeenCalledTimes(2);
    expect(gateway.deleteMessage).not.toHaveBeenCalled();
    expect(delivered.get('21').text).toContain('Yogurt 1 serving');
    expect(delivered.get('22').text).toContain('Chia Seeds 14g');

    now = Date.parse('2026-09-05T21:28:14Z');
    const placement = { id: 'scaleplace', scaleId: 'kitchen', startedAt: new Date(now).toISOString() };
    const scale = new ScaleCapture({ foodLogs, review, userId, conversationId, timezone: 'America/Los_Angeles', clock, logger,
      config: { containers: [], densityLevels: [{ level: 4, label: 'Weighed food', kcal_per_g: 1.4 }] } });
    const snapshot = { grams: 458, unit: 'g', density: null, observationIds: ['weight'], lastInputAt: placement.startedAt };
    await scale.reconcile(placement, snapshot);
    await publisher.publish(userId);
    expect(await items.findByDate(userId, '2026-09-05')).toHaveLength(2);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(2); // headless scale never creates a message
    // Model an already-linked scale receipt (as in the original incident).
    await publisher.bind(userId, placement.id, { conversationId, messageId: '23', caption: false });
    now += 8000;
    await scale.reconcile(placement, { ...snapshot, density: 4, observationIds: ['weight', 'density'] });
    await publisher.publish(userId);
    let rows = await items.findByDate(userId, '2026-09-05');
    expect(rows).toHaveLength(3);
    expect(rows.reduce((total, row) => total + row.calories, 0)).toBe(871);
    expect(rows.every(row => row.review.state === 'provisional' && !row.settled)).toBe(true);
    const scaleRow = rows.find(row => row.logId === placement.id);
    expect(scaleRow).toMatchObject({ grams: 458, calories: 641, protein: null, captureEvidence: { weightBasis: 'gross-assumed-net', tareGrams: null } });
    const originalIds = rows.map(row => row.uuid).sort();
    expect(delivered.get('23').text).toContain('Weighed food 458g');

    // The real guarded repair boundary consumes a structured auditor proposal;
    // neither the model nor the repair service receives a messaging capability.
    const repairs = new NutritionRepairService({ items, foodLogs, review, clock, timezoneFor: () => 'America/Los_Angeles' });
    const yogurtRow = rows.find(row => row.logId === yogurt.nutrilogUuid);
    await repairs.apply({ userId, operationId: 'audit-name', runId: 'audit',
      proposal: { mode: 'verified', reason: 'Product evidence identifies Greek yogurt', updates: [{ id: yogurtRow.uuid, expectedVersion: yogurtRow.version, changes: { name: 'Greek Yogurt' } }] },
      evidence: [{ id: 'label-fact', kind: 'label', data: { name: 'Greek Yogurt' } }],
    });
    await publisher.publish(userId);
    expect(delivered.get('21').text).toContain('Greek Yogurt 1 serving');
    await scale.reconcile(placement, { ...snapshot, grams: 500, density: 4, observationIds: ['weight', 'density', 'later-weight'] });
    await publisher.publish(userId);
    expect(delivered.get('23').text).toContain('Weighed food 500g');

    const health = new HealthOperations({ healthData: {}, nutritionItems: items, today: () => '2026-09-05', clock });
    await health.updateNutritionItem(userId, scaleRow.uuid, { grams: 400, expectedVersion: (await items.findByUuid(userId, scaleRow.uuid)).version });
    await publisher.publish(userId);
    expect(delivered.get('23').text).toContain('Weighed food 400g');
    const day = await health.readNutritionDay(userId, '2026-09-05');
    expect(day.items.find(row => row.uuid === scaleRow.uuid)).toMatchObject({ grams: 400, calories: 560, settledBy: 'user' });
    expect(day.items.find(row => row.uuid === yogurtRow.uuid).name).toBe('Greek Yogurt');
    expect(day.items.map(row => row.uuid).sort()).toEqual(originalIds);

    // Fail an edit, then reconstruct the publisher/stores: retry the same ID.
    const chiaRow = await items.findByLogId(userId, chia.nutrilogUuid);
    await health.updateNutritionItem(userId, chiaRow[0].uuid, { grams: 7, expectedVersion: chiaRow[0].version });
    updateMessage.mockRejectedValueOnce(new Error('Telegram temporarily unavailable'));
    await publisher.publish(userId);
    foodLogs = makeLogs(); items = makeItems();
    publisher = new NutritionReceiptPublisher(publisherDeps());
    await publisher.publish(userId);
    expect(delivered.get('22').text).toContain('Chia Seeds 7g');
    expect([...delivered.keys()].sort()).toEqual(['21', '22', '23']);
    const editCount = updateMessage.mock.calls.length;
    now += 72 * 60 * 60 * 1000;
    review = new FoodLogReview({ foodLogs, items, logger, clock });
    await new NutritionStabilization({ items, review, clock, logger }).run(userId);
    await publisher.publish(userId);
    expect(updateMessage).toHaveBeenCalledTimes(editCount);
    rows = await items.findByDate(userId, '2026-09-05');
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.uuid).sort()).toEqual(originalIds);
    expect(rows.find(row => row.uuid === yogurtRow.uuid)).toMatchObject({ settled: true, settledBy: 'auto' });
    expect(gateway.sendMessage).toHaveBeenCalledTimes(2);
    expect(gateway.updateMessage).not.toHaveBeenCalled();
  });
});
