import { describe, it, expect, vi } from 'vitest';
import { AcceptFoodLog } from './AcceptFoodLog.mjs';

const messagingStub = () => ({
  sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
  updateMessage: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
});

const makePendingLog = ({ mealTime, mealDate = '2026-08-30' } = {}) => ({
  id: 'log-1',
  uuid: 'log-1',
  userId: 'kc',
  status: 'pending',
  meal: { date: mealDate, time: mealTime },
  items: [
    { id: 'i1', uuid: 'i1', label: 'Apple', calories: 95, protein: 0, carbs: 25, fat: 0 },
  ],
  metadata: {},
});

const makeUseCase = ({ nutriLog }) => {
  const foodLogStore = {
    findByUuid: vi.fn(async () => nutriLog),
    updateStatus: vi.fn(async () => {}),
    findPending: vi.fn(async () => []),
  };
  const nutriListStore = { saveMany: vi.fn(async () => {}) };
  const uc = new AcceptFoodLog({
    messagingGateway: messagingStub(),
    foodLogStore,
    nutriListStore,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { uc, foodLogStore, nutriListStore };
};

describe('AcceptFoodLog nutrilist mealTime stamping', () => {
  it('confirms an external barcode log through the web response without contacting its original gateway', async () => {
    const nutriLog = { ...makePendingLog({ mealTime: 'afternoon' }),
      conversationId: 'external:kc', metadata: { source: 'upc', messageId: '22' } };
    const messagingGateway = messagingStub();
    const foodLogStore = { findByUuid: vi.fn(async () => nutriLog), updateStatus: vi.fn(async () => {}) };
    const nutriListStore = { saveMany: vi.fn(async () => {}) };
    const report = { execute: vi.fn() };
    const uc = new AcceptFoodLog({ messagingGateway, foodLogStore, nutriListStore,
      generateDailyReport: report, logger: { debug() {}, info() {}, warn() {}, error() {} } });
    await expect(uc.execute({ userId: 'kc', conversationId: 'web:kc', logUuid: 'log-1',
      responseContext: messagingStub(), autoReport: false })).resolves.toMatchObject({ success: true });
    expect(foodLogStore.updateStatus).toHaveBeenCalledWith('kc', 'log-1', 'accepted');
    expect(nutriListStore.saveMany).toHaveBeenCalledWith([expect.objectContaining({ date: '2026-08-30', mealTime: 'afternoon' })]);
    for (const method of Object.values(messagingGateway)) expect(method).not.toHaveBeenCalled();
    expect(report.execute).not.toHaveBeenCalled();
  });
  it('stamps the nutrilist row with the log\'s meal.time (afternoon)', async () => {
    const nutriLog = makePendingLog({ mealTime: 'afternoon' });
    const { uc, nutriListStore } = makeUseCase({ nutriLog });

    const result = await uc.execute({ userId: 'kc', conversationId: 'web:kc', logUuid: 'log-1' });

    expect(result.success).toBe(true);
    expect(nutriListStore.saveMany).toHaveBeenCalledTimes(1);
    const [savedItems] = nutriListStore.saveMany.mock.calls[0];
    expect(savedItems).toHaveLength(1);
    expect(savedItems[0].mealTime).toBe('afternoon');
  });

  it('stamps null (never undefined) when the log carries no meal.time', async () => {
    const nutriLog = makePendingLog({ mealTime: undefined });
    const { uc, nutriListStore } = makeUseCase({ nutriLog });

    await uc.execute({ userId: 'kc', conversationId: 'web:kc', logUuid: 'log-1' });

    const [savedItems] = nutriListStore.saveMany.mock.calls[0];
    expect(savedItems[0].mealTime).toBe(null);
  });

  it('stamps morning correctly (regression: c5PtjVxcfl-style pending)', async () => {
    const nutriLog = makePendingLog({ mealTime: 'morning' });
    const { uc, nutriListStore } = makeUseCase({ nutriLog });

    await uc.execute({ userId: 'kc', conversationId: 'web:kc', logUuid: 'log-1' });

    const [savedItems] = nutriListStore.saveMany.mock.calls[0];
    expect(savedItems[0].mealTime).toBe('morning');
  });
});
