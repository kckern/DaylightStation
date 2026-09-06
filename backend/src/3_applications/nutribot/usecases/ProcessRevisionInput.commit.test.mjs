/**
 * A revision lands on an ALREADY-COMMITTED log now (captures auto-commit at the
 * router seam), so `updateItems` alone is not enough: the nutrilist rows were
 * written at capture time and `YamlFoodLogDatastore.updateItems` never touches
 * them. Without a re-sync a revision changes nothing the day view shows or
 * BudgetService counts.
 */

import { describe, it, expect, vi } from 'vitest';
import { ProcessRevisionInput } from './ProcessRevisionInput.mjs';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const aiResponse = JSON.stringify({
  items: [
    { name: 'Toast', noom_color: 'yellow', quantity: 2, unit: 'slice', grams: 80, calories: 240, protein: 8, carbs: 40, fat: 4 },
  ],
});

function makeHarness({ existingItems }) {
  const revisedLog = { id: 'log-1', userId: 'kc', status: 'accepted', items: [] };
  const foodLogStore = {
    findByUuid: vi.fn(async () => ({
      id: 'log-1',
      userId: 'kc',
      status: 'accepted',
      meal: { date: '2026-09-02', time: 'morning' },
      items: existingItems,
      metadata: { source: 'text' },
    })),
    updateItems: vi.fn(async (userId, id, items) => ({ ...revisedLog, items })),
  };
  const nutriListStore = { syncFromLog: vi.fn(async () => {}) };
  const receipts = { interaction: vi.fn(async () => {}) };
  const conversationStateStore = {
    get: vi.fn(async () => ({ activeFlow: 'revision', flowState: { pendingLogUuid: 'log-1', originalMessageId: 'bot-1' } })),
    set: vi.fn(async () => {}),
  };
  const uc = new ProcessRevisionInput({
    receipts: () => receipts,
    messagingGateway: { sendMessage: vi.fn(), updateMessage: vi.fn(), deleteMessage: vi.fn() },
    aiGateway: { chat: vi.fn(async () => aiResponse) },
    foodLogStore,
    nutriListStore,
    conversationStateStore,
    logger: silentLogger,
  });
  const updates = [];
  const responseContext = {
    sendMessage: vi.fn(async () => ({ messageId: 'm' })),
    updateMessage: vi.fn(async (messageId, payload) => { updates.push({ messageId, payload }); }),
    deleteMessage: vi.fn(async () => {}),
  };
  return { uc, foodLogStore, nutriListStore, responseContext, updates, receipts };
}

const foodId = '0b1d5fe6-c838-47f4-82e2-d0e47b6f7ea1';
const unsettled = [{ id: 'toast00001', uuid: foodId, label: 'Toast', grams: 40, unit: 'slice', amount: 1, color: 'yellow', calories: 120, settled: false }];
const legacy = [{ id: 'toast00001', uuid: foodId, label: 'Toast', grams: 40, unit: 'slice', amount: 1, color: 'yellow', calories: 120 }];

const run = ({ uc, responseContext }) => uc.execute({
  userId: 'kc', conversationId: 'web:kc', text: 'make it 2 slices', messageId: 'user-1', responseContext,
});

describe('ProcessRevisionInput on a committed log', () => {
  it('loads the current ledger and fences its versions rather than revising the stale capture', async () => {
    const h = makeHarness({ existingItems: unsettled });
    const current = [{ ...unsettled[0], version: 8, date: '2026-09-05', mealTime: null,
      fiber: null, photoRef: 'saved-photo', cleanupEvidence: { name: ['label'] }, manualFields: ['date'] }];
    h.nutriListStore.findByLogId = vi.fn(async () => current);
    await run(h);
    expect(h.nutriListStore.syncFromLog.mock.calls[0][1]).toEqual({ revision: true, expectedVersions: [{ id: foodId, version: 8 }] });
    expect(h.nutriListStore.syncFromLog.mock.calls[0][0].items[0]).toMatchObject({ uuid: foodId, date: '2026-09-05', mealTime: null,
      fiber: null, photoRef: 'saved-photo', cleanupEvidence: { name: ['label'] } });
  });
  it('does not rewrite evidence or claim success when the consumed ledger conflicts', async () => {
    const h = makeHarness({ existingItems: unsettled });
    h.nutriListStore.syncFromLog.mockRejectedValue(Object.assign(new Error('Entry corrected elsewhere'), { code: 'VERSION_CONFLICT' }));
    await expect(run(h)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(h.foodLogStore.updateItems).not.toHaveBeenCalled();
    expect(h.updates.every(update => !JSON.stringify(update.payload).includes('240'))).toBe(true);
  });
  it('re-syncs the nutrilist so the revision reaches the day view', async () => {
    const h = makeHarness({ existingItems: unsettled });
    const result = await run(h);

    expect(result.success).toBe(true);
    expect(h.foodLogStore.updateItems).toHaveBeenCalledTimes(1);
    expect(h.nutriListStore.syncFromLog).toHaveBeenCalledTimes(1);

    const [syncedLog] = h.nutriListStore.syncFromLog.mock.calls[0];
    expect(syncedLog.id).toBe('log-1');
    expect(syncedLog.items).toHaveLength(1);
    expect(syncedLog.items[0].calories).toBe(240);
  });

  it('protects a user-revised portion from further automatic review', async () => {
    const h = makeHarness({ existingItems: unsettled });
    await run(h);

    const [, , items] = h.foodLogStore.updateItems.mock.calls[0];
    expect(items.every(i => i.settled === false && !i.settledBy)).toBe(true);
    expect(items[0].uuid).toBe(foodId);
    expect(items[0].manualFields).toContain('grams');
  });

  it('records explicit user revision on legacy rows too', async () => {
    const h = makeHarness({ existingItems: legacy });
    await run(h);

    const [, , items] = h.foodLogStore.updateItems.mock.calls[0];
    for (const item of items) { expect(item.settledBy).toBeUndefined(); expect(item.manualFields).toContain('grams'); }
  });

  it('restores the shared receipt rather than composing a second confirmation', async () => {
    const h = makeHarness({ existingItems: unsettled });
    await run(h);

    expect(h.updates).toEqual([]);
    expect(h.receipts.interaction.mock.calls).toEqual([['kc', 'log-1', 'processing'], ['kc', 'log-1', null]]);
  });
});
