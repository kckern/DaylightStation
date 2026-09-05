import { describe, it, expect, vi } from 'vitest';
import { NutritionSurfaceSync } from './NutritionSurfaceSync.mjs';

function fixture() {
  const log = { id: 'capture', status: 'pending', conversationId: 'surface:alice',
    metadata: { messageId: '22', source: 'upc' }, items: [{ label: 'Protein shake', calories: 160 }] };
  const rows = [];
  const saved = new Map();
  const deps = {
    users: () => ['alice'], destinationFor: () => 'surface:alice',
    linkFor: (entry, destination) => entry.conversationId === destination && entry.metadata.messageId
      ? { messageId: entry.metadata.messageId, caption: true } : null,
    foodLogs: { findAll: vi.fn(async () => [log]) },
    items: { findByDateRange: vi.fn(async () => rows) },
    checkpoints: { load: vi.fn(async id => structuredClone(saved.get(id))),
      save: vi.fn(async (id, state) => saved.set(id, structuredClone(state))) },
    surface: { updateMessage: vi.fn(async () => {}), report: vi.fn(async () => {}) },
    logger: { info: vi.fn(), warn: vi.fn() },
  };
  const add = (date = '2026-09-04') => {
    log.status = 'accepted';
    rows.push({ uuid: 'food', logId: 'capture', name: 'Protein shake', date,
      mealTime: 'afternoon', grams: 325, calories: 160, protein: 30 });
  };
  return { deps, log, rows, saved, add, sync: new NutritionSurfaceSync(deps) };
}

describe('NutritionSurfaceSync', () => {
  it('publishes a headless pending capture once, and syncs review date changes', async () => {
    const f = fixture();
    f.log.conversationId = 'device:alice'; f.log.meal = { date: '2026-09-04', time: 'afternoon' };
    f.deps.surface.createPending = vi.fn(async () => ({ messageId: '33', caption: false }));
    await f.sync.run();
    await new NutritionSurfaceSync(f.deps).run();
    expect(f.deps.surface.createPending).toHaveBeenCalledTimes(1);
    f.log.meal.date = '2026-09-03';
    await f.sync.run();
    expect(f.deps.surface.updateMessage).toHaveBeenCalledWith('surface:alice',
      { messageId: '33', caption: false }, expect.stringContaining('2026-09-03'), { pending: 'capture' });
    expect(f.deps.surface.report).not.toHaveBeenCalled();
  });
  it('does not retry permanently unavailable messages after restart', async () => {
    const f = fixture(); await f.sync.run(); f.add();
    f.deps.surface.updateMessage.mockRejectedValueOnce(Object.assign(new Error('Deleted'), { permanent: true }));
    await f.sync.run();
    await new NutritionSurfaceSync(f.deps).run();
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(1);
    expect(f.deps.surface.report).toHaveBeenCalledTimes(1);
  });
  it('uses store revisions to skip unchanged full ledger and archive reads', async () => {
    const f = fixture();
    f.deps.foodLogs.getRevision = vi.fn(async () => 'logs-v1');
    f.deps.items.getRevision = vi.fn(async () => 'ledger-v1');
    await f.sync.run(); await f.sync.run();
    expect(f.deps.foodLogs.findAll).toHaveBeenCalledTimes(1);
    expect(f.deps.items.findByDateRange).toHaveBeenCalledTimes(1);
    f.deps.items.getRevision.mockResolvedValue('ledger-v2');
    f.add(); await f.sync.run();
    expect(f.deps.items.findByDateRange).toHaveBeenCalledTimes(2);
  });
  it('attaches quietly, then confirms a pending scan and acknowledges deliveries once', async () => {
    const f = fixture();
    await f.sync.run();
    expect(f.deps.surface.updateMessage).not.toHaveBeenCalled();
    expect(f.deps.surface.report).not.toHaveBeenCalled();
    f.add();
    await f.sync.run();
    expect(f.deps.surface.updateMessage).toHaveBeenCalledWith('surface:alice',
      { messageId: '22', caption: true }, expect.stringContaining('160 kcal'));
    expect(f.deps.surface.report).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-09-04', items: [expect.objectContaining({ calories: 160 })],
    }));
    await f.sync.run();
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(1);
    expect(f.deps.surface.report).toHaveBeenCalledTimes(1);
  });

  it('uses edited ledger portions and dates, not the original capture', async () => {
    const f = fixture(); f.add(); await f.sync.run();
    f.rows[0] = { ...f.rows[0], grams: 162.5, calories: 80, date: '2026-09-05' };
    await f.sync.run();
    expect(f.deps.surface.updateMessage.mock.calls[0][2]).toContain('2026-09-05 afternoon · Protein shake · 162.5 g · 80 kcal');
    expect(f.deps.surface.report.mock.calls.map(([input]) => [input.date, input.items.length]))
      .toEqual([['2026-09-04', 0], ['2026-09-05', 1]]);
  });

  it('updates the linked receipt and zeroes the report when the last food is deleted', async () => {
    const f = fixture(); f.add(); await f.sync.run();
    f.rows.length = 0;
    await f.sync.run();
    expect(f.deps.surface.updateMessage.mock.calls[0][2]).toContain('Removed from food log');
    expect(f.deps.surface.report).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-09-04', items: [] }));
  });

  it('retries a failed message after restart without resending a successful report', async () => {
    const f = fixture(); await f.sync.run(); f.add();
    f.deps.surface.updateMessage.mockRejectedValueOnce(new Error('offline'));
    await f.sync.run();
    expect(f.rows[0].calories).toBe(160);
    await new NutritionSurfaceSync(f.deps).run();
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(2);
    expect(f.deps.surface.report).toHaveBeenCalledTimes(1);
  });

  it('retries failed reports independently of successful message updates', async () => {
    const f = fixture(); await f.sync.run(); f.add();
    f.deps.surface.report.mockRejectedValueOnce(new Error('render failed'));
    await f.sync.run();
    await new NutritionSurfaceSync(f.deps).run();
    expect(f.deps.surface.updateMessage).toHaveBeenCalledTimes(1);
    expect(f.deps.surface.report).toHaveBeenCalledTimes(2);
  });

  it('does not create a surface dependency for an unconnected user or update foreign messages', async () => {
    const f = fixture(); f.deps.destinationFor = () => null;
    await f.sync.run();
    expect(f.deps.foodLogs.findAll).not.toHaveBeenCalled();
    f.deps.destinationFor = () => 'surface:alice';
    f.log.conversationId = 'surface:other';
    await f.sync.run(); f.add(); await f.sync.run();
    expect(f.deps.surface.updateMessage).not.toHaveBeenCalled();
    expect(f.deps.surface.report).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping polls and excludes pending rows from reports', async () => {
    const f = fixture(); await f.sync.run();
    f.rows.push({ uuid: 'pending', status: 'pending', date: '2026-09-04', calories: 999 });
    const first = f.sync.run();
    expect(f.sync.run()).toBe(first);
    await first;
    expect(f.deps.surface.report).not.toHaveBeenCalled();
  });
});
