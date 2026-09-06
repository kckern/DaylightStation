import { describe, it, expect, vi } from 'vitest';
import { NutritionReceiptPublisher } from './NutritionReceiptPublisher.mjs';
import { NutritionReceiptRenderer } from '#rendering/nutribot/NutritionReceiptRenderer.mjs';

function fixture() {
  const logs = [{ id: 'capture', status: 'accepted', conversationId: 'telegram:alice',
    meal: { date: '2026-09-05', time: 'midday' }, items: [{ label: 'Stale yogurt', grams: 1 }], metadata: { messageId: '22' } }];
  const rows = [{ uuid: 'food', logId: 'capture', name: 'Yogurt', grams: 170, calories: 160, color: 'yellow' }];
  let saved = null;
  const deps = {
    destinationFor: () => 'telegram:alice',
    linkFor: log => log.conversationId === 'telegram:alice' && log.metadata.messageId ? { messageId: log.metadata.messageId, caption: false } : null,
    foodLogs: { findAll: vi.fn(async () => structuredClone(logs)) },
    items: { findByDateRange: vi.fn(async () => structuredClone(rows)) },
    checkpoints: { load: vi.fn(async () => structuredClone(saved)), save: vi.fn(async (_, state) => { saved = structuredClone(state); }) },
    renderer: new NutritionReceiptRenderer(), surface: { updateMessage: vi.fn(async () => {}) },
    logger: { info: vi.fn(), warn: vi.fn() },
  };
  const publisher = new NutritionReceiptPublisher(deps);
  return { logs, rows, deps, publisher, saved: () => saved };
}

describe('NutritionReceiptPublisher', () => {
  it('validates selective repair and preflights all preview fingerprints before any edit', async () => {
    const f = fixture();
    f.logs.push({ ...structuredClone(f.logs[0]), id: 'second', metadata: { messageId: '23' } });
    f.rows.push({ ...f.rows[0], uuid: 'second-food', logId: 'second' });
    expect(() => f.publisher.reconcile('alice', { logIds: [] })).toThrow();
    expect(() => f.publisher.reconcile('alice', { logIds: ['capture'], expectedFingerprints: null })).toThrow();
    expect(() => f.publisher.reconcile('alice', { logIds: ['capture'], dryRun: false })).toThrow('Preview');
    await expect(f.publisher.reconcile('alice', { logIds: ['missing'] })).rejects.toMatchObject({ status: 404 });
    const logIds = ['capture', 'second'];
    const preview = await f.publisher.reconcile('alice', { logIds });
    expect(f.saved()).toBeNull();
    const expectedFingerprints = Object.fromEntries(preview.receipts.map(row => [row.logId, row.fingerprint]));
    f.rows[1].grams = 80;
    await expect(f.publisher.reconcile('alice', { logIds, expectedFingerprints, dryRun: false })).rejects.toMatchObject({ status: 409 });
    expect(f.deps.surface.updateMessage).not.toHaveBeenCalled();
    const latest = await f.publisher.reconcile('alice', { logIds });
    const result = await f.publisher.reconcile('alice', { logIds, dryRun: false,
      expectedFingerprints: Object.fromEntries(latest.receipts.map(row => [row.logId, row.fingerprint])) });
    expect(result.receipts.map(row => row.delivery)).toEqual(['updated', 'updated']);
  });
  it('skips unchanged archive reads/checkpoint writes but never caches a failed edit', async () => {
    const f = fixture();
    let revision = 1;
    f.deps.items.getRevision = () => revision;
    f.deps.foodLogs.getRevision = () => 1;
    await f.publisher.publish('alice');
    const saves = f.deps.checkpoints.save.mock.calls.length;
    await f.publisher.publish('alice');
    expect(f.deps.items.findByDateRange).toHaveBeenCalledTimes(1);
    expect(f.deps.checkpoints.save).toHaveBeenCalledTimes(saves);
    f.rows[0].grams = 85; revision++;
    f.deps.surface.updateMessage.mockRejectedValueOnce(new Error('offline'));
    await f.publisher.publish('alice');
    await f.publisher.publish('alice');
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(2);
    await f.publisher.publish('alice');
    expect(f.deps.items.findByDateRange).toHaveBeenCalledTimes(3);
  });
  it('baselines historical receipts without a mass rewrite, previews without saving, repairs only selected receipts', async () => {
    const f = fixture();
    await f.publisher.publish('alice');
    expect(f.deps.surface.updateMessage).not.toHaveBeenCalled();
    const state = structuredClone(f.saved());
    const preview = await f.publisher.publish('alice', { logIds: ['capture'], force: true, dryRun: true });
    expect(preview.receipts[0].text).toContain('🟡 Yogurt 170g');
    expect(f.saved()).toEqual(state);
    await f.publisher.publish('alice', { logIds: ['capture'], force: true });
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(1);
  });
  it('binds a processing message before commit, then populates it once from saved ledger rows', async () => {
    const f = fixture(); f.logs[0].status = 'pending';
    await f.publisher.bind('alice', 'capture', { conversationId: 'telegram:alice', messageId: '22', caption: true });
    expect(f.deps.surface.updateMessage).not.toHaveBeenCalled();
    f.logs[0].status = 'accepted';
    await f.publisher.refresh('alice', 'capture');
    await f.publisher.refresh('alice', 'capture');
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(1);
    expect(f.deps.surface.updateMessage).toHaveBeenCalledWith('telegram:alice', { messageId: '22', caption: true },
      expect.objectContaining({ text: expect.stringContaining('Yogurt 170g'), choices: expect.any(Array) }));
  });
  it('updates visible changes but ignores evidence-only changes and 72-hour stabilization', async () => {
    const f = fixture(); await f.publisher.publish('alice');
    f.rows[0].grams = 85; await f.publisher.refresh('alice', 'capture');
    f.rows[0].version = 4; f.rows[0].cleanupEvidence = { grams: ['fact'] };
    f.rows[0].settled = true; f.rows[0].review = { state: 'stabilized' };
    await f.publisher.publish('alice');
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(1);
    expect(f.deps.surface.updateMessage.mock.calls[0][2].text).toContain('Yogurt 85g');
  });
  it('retries the SAME known message after failure and restart', async () => {
    const f = fixture(); await f.publisher.publish('alice');
    f.rows[0].grams = 85;
    f.deps.surface.updateMessage.mockRejectedValueOnce(new Error('network'));
    await f.publisher.publish('alice');
    await new NutritionReceiptPublisher(f.deps).publish('alice');
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(2);
    expect(f.deps.surface.updateMessage.mock.calls.map(call => call[1].messageId)).toEqual(['22', '22']);
    await f.publisher.publish('alice');
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(2);
  });
  it('serializes concurrent foreground/background edits and reads latest state inside each queued job', async () => {
    const f = fixture(); await f.publisher.publish('alice');
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    f.deps.surface.updateMessage.mockImplementationOnce(async () => { started(); await new Promise(resolve => { release = resolve; }); });
    f.rows[0].grams = 85;
    const first = f.publisher.refresh('alice', 'capture'); await waiting;
    const second = f.publisher.refresh('alice', 'capture');
    f.rows[0].grams = 458;
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]);
    expect(f.deps.surface.updateMessage.mock.calls.map(call => call[2].text.match(/Yogurt (\d+)g/)[1])).toEqual(['85', '458']);
  });
  it('keeps the user edit interaction while automatic repairs arrive, then restores controls', async () => {
    const f = fixture(); await f.publisher.publish('alice');
    await f.publisher.interaction('alice', 'capture', 'revision');
    f.rows[0].grams = 85; await f.publisher.publish('alice');
    expect(f.deps.surface.updateMessage.mock.lastCall[2].text).toContain('Reply with what to change.');
    await f.publisher.interaction('alice', 'capture', null);
    expect(f.deps.surface.updateMessage.mock.lastCall[2].choices[0].map(button => JSON.parse(button.callback_data).cmd)).toEqual(['x', 'r']);
  });
  it('does not create receipts for headless captures, foreign chats, or permanently deleted messages', async () => {
    const f = fixture(); f.logs[0].conversationId = 'device:alice'; delete f.logs[0].metadata.messageId;
    await f.publisher.publish('alice');
    await f.publisher.bind('alice', 'capture', { conversationId: 'web:alice', messageId: 'local_1' });
    expect(f.deps.surface.updateMessage).not.toHaveBeenCalled();
    f.deps.surface.updateMessage.mockRejectedValueOnce(Object.assign(new Error('deleted'), { permanent: true }));
    await f.publisher.bind('alice', 'capture', { conversationId: 'telegram:alice', messageId: '22' });
    f.rows[0].grams = 85;
    await new NutritionReceiptPublisher(f.deps).publish('alice');
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(1);
  });
  it('shows removals without resurrecting the original parser items', async () => {
    const f = fixture(); await f.publisher.publish('alice'); f.rows.length = 0;
    await f.publisher.refresh('alice', 'capture');
    expect(f.deps.surface.updateMessage.mock.lastCall[2]).toEqual({ text: '↩️ Removed from food log', choices: [] });
    f.logs[0].status = 'deleted';
    f.rows.push({ uuid: 'food', logId: 'capture', name: 'Restored Yogurt', grams: 85, color: 'yellow' });
    await f.publisher.refresh('alice', 'capture');
    expect(f.deps.surface.updateMessage.mock.lastCall[2].text).toContain('Restored Yogurt 85g');
    expect(f.deps.surface.updateMessage.mock.lastCall[1].messageId).toBe('22');
  });
});
