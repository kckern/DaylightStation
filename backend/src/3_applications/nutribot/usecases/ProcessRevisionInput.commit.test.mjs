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
  const conversationStateStore = {
    get: vi.fn(async () => ({ activeFlow: 'revision', flowState: { pendingLogUuid: 'log-1', originalMessageId: 'bot-1' } })),
    set: vi.fn(async () => {}),
  };
  const uc = new ProcessRevisionInput({
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
  return { uc, foodLogStore, nutriListStore, responseContext, updates };
}

const unsettled = [{ id: 'i1', uuid: 'i1', label: 'Toast', grams: 40, unit: 'slice', amount: 1, color: 'yellow', calories: 120, settled: false }];
const legacy = [{ id: 'i1', uuid: 'i1', label: 'Toast', grams: 40, unit: 'slice', amount: 1, color: 'yellow', calories: 120 }];

const run = ({ uc, responseContext }) => uc.execute({
  userId: 'kc', conversationId: 'web:kc', text: 'make it 2 slices', messageId: 'user-1', responseContext,
});

describe('ProcessRevisionInput on a committed log', () => {
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

  it('carries settled:false forward onto the revised items', async () => {
    const h = makeHarness({ existingItems: unsettled });
    await run(h);

    const [, , items] = h.foodLogStore.updateItems.mock.calls[0];
    expect(items.every(i => i.settled === false)).toBe(true);
  });

  it('leaves settled ABSENT when the existing items are legacy rows', async () => {
    const h = makeHarness({ existingItems: legacy });
    await run(h);

    const [, , items] = h.foodLogStore.updateItems.mock.calls[0];
    for (const item of items) expect('settled' in item).toBe(false);
  });

  it('offers Undo/Edit, never Accept, on the revised message', async () => {
    const h = makeHarness({ existingItems: unsettled });
    await run(h);

    const final = h.updates[h.updates.length - 1];
    const buttons = (final.payload.choices || []).flat();
    const cmds = buttons.map(b => JSON.parse(b.callback_data).cmd);

    expect(cmds).not.toContain('a');
    expect(cmds.sort()).toEqual(['r', 'x']);
    expect(buttons.some(b => /Accept/i.test(b.text))).toBe(false);
    expect(buttons.some(b => /Undo/i.test(b.text))).toBe(true);
  });
});
