/**
 * A quarantined barcode capture (calories unknown) is pending on purpose. Every
 * path that sweeps pending logs into the ledger must leave it alone, and no
 * pending-count guard may wait on it — or one unknown barcode blocks every
 * auto-report until someone notices.
 */
import { describe, it, expect, vi } from 'vitest';
import { GenerateDailyReport } from './GenerateDailyReport.mjs';
import { ConfirmAllPending } from './ConfirmAllPending.mjs';
import { AcceptFoodLog } from './AcceptFoodLog.mjs';
import { quarantineMarker } from '#domains/nutrition/services/quarantine.mjs';

const logger = { info() {}, debug() {}, warn() {}, error() {} };
const pendingLog = (id, metadata = {}) => ({
  id, status: 'pending', meal: { date: '2026-09-22', time: 'afternoon' },
  items: [{ id: `${id}-i`, label: 'Thing', calories: metadata.quarantined ? null : 100 }], metadata,
  accept: vi.fn(function accept() { return { ...this, status: 'accepted' }; }),
});

describe('GenerateDailyReport and quarantined captures', () => {
  function report(pending) {
    const messagingGateway = { sendMessage: vi.fn(async () => ({ messageId: 'n' })), deleteMessage: vi.fn(async () => {}),
      sendPhoto: vi.fn(async () => ({ messageId: 'n' })) };
    const foodLogStore = { findPending: vi.fn(async () => pending), save: vi.fn(async () => {}) };
    const nutriListStore = { syncFromLog: vi.fn(async () => {}) };
    const reportDelivery = { prepare: vi.fn(async () => ({ sendTo: async (gateway, caption, options) => gateway.sendPhoto('r', caption, options) })) };
    const uc = new GenerateDailyReport({ messagingGateway, foodLogStore, nutriListStore, reportDelivery,
      config: { getUserGoals: () => ({ calories: 2000 }) },
      conversationStateStore: { get: async () => ({}), set: vi.fn(async () => {}) }, logger });
    const input = { userId: 'alice', conversationId: 'surface:alice', date: '2026-09-22',
      suppressCoaching: true, syncSnapshot: { items: [], history: [] } };
    return { uc, input, foodLogStore, nutriListStore, messagingGateway };
  }

  it('a quarantined capture does not hold the report back', async () => {
    const q = pendingLog('q', quarantineMarker());
    const f = report([q]);
    const out = await f.uc.execute(f.input);
    expect(out.skipped).toBeFalsy();
    expect(f.messagingGateway.sendMessage).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/still need confirmation/), expect.anything());
  });

  it('auto-accept (the /report path) accepts ordinary pending logs and skips the quarantined one', async () => {
    const q = pendingLog('q', quarantineMarker());
    const p = pendingLog('p');
    const f = report([q, p]);
    await f.uc.execute({ ...f.input, autoAcceptPending: true });
    expect(p.accept).toHaveBeenCalled();
    expect(q.accept).not.toHaveBeenCalled();
    expect(f.nutriListStore.syncFromLog).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmAllPending and quarantined captures', () => {
  it('confirms the rest and leaves the quarantined capture pending', async () => {
    const q = pendingLog('q', quarantineMarker());
    const p = pendingLog('p');
    const foodLogStore = { findPending: vi.fn(async () => [q, p]), save: vi.fn(async () => {}) };
    const uc = new ConfirmAllPending({ foodLogStore, nutriListStore: { syncFromLog: vi.fn(async () => {}) }, logger });
    const out = await uc.execute({ userId: 'alice', conversationId: 'c' });
    expect(out.confirmedCount).toBe(1);
    expect(q.accept).not.toHaveBeenCalled();
    expect(foodLogStore.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'p', status: 'accepted' }));
  });
});

describe('AcceptFoodLog auto-report and quarantined captures', () => {
  it('generates the report when only a quarantined capture remains pending', async () => {
    const nutriLog = { ...pendingLog('log-1'), userId: 'kc', metadata: {} };
    const foodLogStore = { findByUuid: vi.fn(async () => nutriLog), updateStatus: vi.fn(async () => {}),
      findPending: vi.fn(async () => [pendingLog('q', quarantineMarker())]) };
    const generateDailyReport = { execute: vi.fn(async () => ({ success: true })) };
    const uc = new AcceptFoodLog({ messagingGateway: { sendMessage: vi.fn(), updateMessage: vi.fn(), deleteMessage: vi.fn() },
      foodLogStore, nutriListStore: { saveMany: vi.fn(async () => {}) }, generateDailyReport, logger, pause: async () => {} });
    await uc.execute({ userId: 'kc', conversationId: 'web:kc', logUuid: 'log-1' });
    expect(generateDailyReport.execute).toHaveBeenCalled();
  });
});
