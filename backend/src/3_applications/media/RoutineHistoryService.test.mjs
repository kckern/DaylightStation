import { describe, it, expect, vi } from 'vitest';
import { RoutineHistoryService } from './RoutineHistoryService.mjs';

const T0 = Date.parse('2026-10-03T14:02:00.000Z');

function build({ plays = [], screensView = null } = {}) {
  let runs = [];
  let now = T0;
  const store = { load: vi.fn(async () => structuredClone(runs)), save: vi.fn(async (r) => { runs = structuredClone(r); }) };
  const screens = {
    nameOf: async (id) => ({ 'fleet:livingroom-tv': 'Living Room TV', 'browser:k': 'Kitchen tablet' }[id] ?? null),
    names: async () => ({ 'fleet:livingroom-tv': 'Living Room TV', 'browser:k': 'Kitchen tablet', 'browser:dup': 'Kitchen tablet' }),
    aliasesOf: async (id) => (id === 'browser:k' ? ['browser:k', 'browser:dup'] : [id]),
    list: async () => screensView,
  };
  const catalog = {
    invalidate: vi.fn(),
    knows: vi.fn((id) => id === 'automation:kitchen_button_1'),
    list: async () => ({ routines: [{ id: 'automation:kitchen_button_1', name: 'Kitchen Button 1', targets: [{ deviceId: 'fleet:livingroom-tv' }] }] }),
  };
  const playLedger = { plays: vi.fn(async () => plays) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const service = new RoutineHistoryService({ store, catalog, screens, playLedger, clock: { now: () => now }, logger });
  return { service, store, catalog, logger, playLedger, advance: (ms) => { now += ms; } };
}

describe('RoutineHistoryService', () => {
  it('records a run with a plain reason, logs it, and lists newest first with the item that then played', async () => {
    const plays = [
      { deviceId: 'fleet:livingroom-tv', contentId: 'plex:99', title: 'Morning Hymn', startedAt: new Date(T0 + 40_000).toISOString() },
      { deviceId: 'fleet:livingroom-tv', contentId: 'plex:100', title: 'Second', startedAt: new Date(T0 + 200_000).toISOString() },
    ];
    const { service, logger, catalog, advance } = build({ plays });
    const routine = { kind: 'routine', id: 'automation:kitchen_button_1', name: 'Kitchen Button 1' };
    await service.record({ routine, deviceId: 'fleet:livingroom-tv', query: { queue: 'morning-program' }, result: { ok: true } });
    advance(3_600_000);
    await service.record({ routine, deviceId: 'fleet:livingroom-tv', query: { queue: 'morning-program' }, result: { ok: false, failedStep: 'power' } });
    expect(logger.warn).toHaveBeenCalledWith('media.routines.run', expect.objectContaining({ outcome: 'failed', reason: 'Living Room TV did not turn on' }));
    // A run of a routine the catalog already knows does not throw the catalog away.
    expect(catalog.invalidate).not.toHaveBeenCalled();
    const { items } = await service.list({});
    expect(items.map((r) => r.outcome)).toEqual(['failed', 'started']);
    expect(items[1]).toMatchObject({
      routine: { id: 'automation:kitchen_button_1', name: 'Kitchen Button 1' },
      deviceId: 'fleet:livingroom-tv', screenName: 'Living Room TV',
      what: { key: 'queue', value: 'morning-program', contentId: null },
      played: { contentId: 'plex:99', title: 'Morning Hymn' },
    });
    expect(items[0].played).toBeNull();
    await service.record({ routine: { id: null, name: 'Brand new' }, deviceId: 'fleet:livingroom-tv', result: { ok: true } });
    expect(catalog.invalidate).toHaveBeenCalledTimes(1);
  });

  it('filters by screen (including merged duplicates) and routine', async () => {
    const { service } = build();
    await service.record({ routine: { id: 'r1', name: 'One' }, deviceId: 'browser:dup', query: {}, result: { ok: true } });
    await service.record({ routine: { id: 'r2', name: 'Two' }, deviceId: 'fleet:livingroom-tv', query: {}, result: { ok: true } });
    expect((await service.list({ deviceId: 'browser:k' })).items.map((r) => r.routine.id)).toEqual(['r1']);
    expect((await service.list({ routineId: 'r2' })).items.map((r) => r.deviceId)).toEqual(['fleet:livingroom-tv']);
  });

  it('a history write failure never reaches the load', async () => {
    const { service, store, logger } = build();
    store.save.mockRejectedValueOnce(new Error('EROFS'));
    const run = await service.record({ routine: { id: 'r', name: 'R' }, deviceId: 'fleet:livingroom-tv', result: { ok: true } });
    expect(run.outcome).toBe('started');
    expect(logger.warn).toHaveBeenCalledWith('media.routines.history_write_failed', expect.objectContaining({ error: 'EROFS' }));
  });

  it('flags come from the catalog, the registry and the last runs', async () => {
    const { service } = build({
      screensView: { screens: [{ id: 'fleet:livingroom-tv', name: 'Living Room TV', kind: 'screen', wakeable: true, online: false, aliases: [] }], notSeenLately: [], retired: [] },
    });
    expect((await service.flags({})).items).toEqual([{
      routine: { id: 'automation:kitchen_button_1', name: 'Kitchen Button 1' }, deviceId: 'fleet:livingroom-tv', screenName: 'Living Room TV',
      problem: 'off', severity: 'info', reason: 'Living Room TV is off; the routine will turn it on',
    }]);
  });
});
