import { it, expect, vi } from 'vitest';
import { MoveItemToDate } from './MoveItemToDate.mjs';
function harness() {
  const rows = [{ uuid: 'parent', kind: 'group', date: '2020-01-01', name: 'Meal' }, { uuid: 'child', parentId: 'parent', date: '2020-01-01' }];
  const store = { findByUuid: vi.fn(async () => rows[0]), findByDate: vi.fn(async () => rows), mutateEntries: vi.fn(async () => {}) };
  const state = { get: vi.fn(async () => ({})), set: vi.fn(), clear: vi.fn() };
  const messaging = { updateMessage: vi.fn(), deleteMessage: vi.fn(), sendMessage: vi.fn() };
  const report = { execute: vi.fn() };
  const uc = new MoveItemToDate({ messagingGateway: messaging, conversationStateStore: state, foodLogStore: {}, nutriListStore: store, config: {}, generateDailyReport: report, logger: { debug() {}, info() {}, error() {} } });
  return { uc, store, state, report };
}
it('opens the date chooser without mutating when no destination was selected', async () => {
  const h = harness();
  expect(await h.uc.execute({ userId: 'u', entryId: 'parent', conversationId: 'c' })).toMatchObject({ showingDatePicker: true });
  expect(h.store.mutateEntries).not.toHaveBeenCalled();
  expect(h.state.set).toHaveBeenCalledWith('c', expect.objectContaining({ flowState: expect.objectContaining({ date: '2020-01-01' }) }));
});
it('moves the entire archived group using its actual source date in one command', async () => {
  const h = harness();
  await h.uc.execute({ userId: 'u', entryId: 'parent', conversationId: 'c', newDate: '2026-09-04' });
  expect(h.store.findByDate).toHaveBeenCalledWith('u', '2020-01-01');
  expect(h.store.mutateEntries).toHaveBeenCalledWith('u', { updates: [{ id: 'parent', changes: { date: '2026-09-04' } }, { id: 'child', changes: { date: '2026-09-04' } }] });
  expect(h.report.execute).toHaveBeenCalledWith(expect.objectContaining({ date: '2020-01-01' }));
});
