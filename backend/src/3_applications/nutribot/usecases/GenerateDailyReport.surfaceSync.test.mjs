import { describe, it, expect, vi } from 'vitest';
import { GenerateDailyReport } from './GenerateDailyReport.mjs';

function fixture() {
  const state = { lastReportMessageId: 'previous', lastReportDate: '2026-09-04' };
  const messagingGateway = { sendMessage: vi.fn(async () => ({ messageId: 'new' })),
    deleteMessage: vi.fn(async () => {}), sendPhoto: vi.fn(async () => ({ messageId: 'new' })) };
  const foodLogStore = { getDailySummary: vi.fn(() => { throw new Error('stale capture must not be read'); }),
    findPending: vi.fn(() => { throw new Error('pending food must not block a report'); }) };
  const reportDelivery = { prepare: vi.fn(async () => ({ sendTo: async (gateway, caption, options) => gateway.sendPhoto('rendered', caption, options) })) };
  const report = new GenerateDailyReport({ messagingGateway, foodLogStore, nutriListStore: {},
    config: { getUserGoals: () => ({ calories: 2000 }) }, reportDelivery,
    conversationStateStore: { get: async () => state, set: vi.fn(async () => {}) },
    logger: { info() {}, debug() {}, warn() {}, error() {} },
  });
  const input = { userId: 'alice', conversationId: 'surface:alice', date: '2026-09-04',
    skipPendingCheck: true, suppressCoaching: true, syncSnapshot: { items: [], history: [] } };
  return { report, messagingGateway, reportDelivery, state, input };
}

describe('daily reports from committed snapshots', () => {
  it('delivers an empty day after deletion and replaces the old report only after sending', async () => {
    const f = fixture();
    expect((await f.report.execute(f.input)).success).toBe(true);
    expect(f.reportDelivery.prepare.mock.calls[0][0].totalCalories).toBe(0);
    expect(f.messagingGateway.sendPhoto.mock.invocationCallOrder[0]).toBeLessThan(f.messagingGateway.deleteMessage.mock.invocationCallOrder[0]);
    expect(f.messagingGateway.deleteMessage).toHaveBeenCalledWith('surface:alice', 'previous');
    expect(f.state.nutritionReportMessages['2026-09-04']).toBe('new');
  });

  it('uses current ledger nutrition, including manual entries without capture logs', async () => {
    const f = fixture();
    f.input.syncSnapshot.items = [{ uuid: 'manual', name: 'Toast', calories: 120, protein: 4, carbs: 22, fat: 2, grams: 40, color: 'yellow' }];
    await f.report.execute(f.input);
    expect(f.reportDelivery.prepare.mock.calls[0][0]).toMatchObject({ totalCalories: 120, macroGrams: { protein: 4, carbs: 22, fat: 2 } });
  });

  it('keeps the old report and propagates render failures for retry', async () => {
    const f = fixture(); f.reportDelivery.prepare.mockRejectedValue(new Error('renderer offline'));
    await expect(f.report.execute(f.input)).rejects.toThrow('renderer offline');
    expect(f.messagingGateway.deleteMessage).not.toHaveBeenCalled();
    expect(f.messagingGateway.sendPhoto).not.toHaveBeenCalled();
  });
});
