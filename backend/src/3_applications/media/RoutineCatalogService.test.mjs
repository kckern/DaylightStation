import { describe, it, expect, vi } from 'vitest';
import { RoutineCatalogService } from './RoutineCatalogService.mjs';

const haConfig = {
  restCommands: { device_livingroom_tv: { url: 'http://x/api/v1/device/livingroom-tv/{{ action }}' } },
  scripts: {},
  automations: [
    { id: 'kitchen_button_1', alias: 'Kitchen Button 1', actions: [{ service: 'rest_command.device_livingroom_tv', data: { action: 'load?queue=morning-program' } }] },
  ],
};

function snapshots(initial = null) {
  let saved = initial;
  return { load: vi.fn(async () => saved), save: vi.fn(async (s) => { saved = s; }) };
}

describe('RoutineCatalogService', () => {
  it('reads the live Home Assistant config when it is reachable', async () => {
    const live = { name: 'home-assistant', available: () => true, read: vi.fn(async () => haConfig) };
    const service = new RoutineCatalogService({ liveSources: [live], snapshots: snapshots(), clock: { now: () => 0 } });
    const { routines, sources } = await service.list({});
    expect(routines.map((r) => r.id)).toEqual(['automation:kitchen_button_1']);
    expect(sources.find((s) => s.kind === 'live')).toMatchObject({ available: true, count: 1 });
    expect(await service.targeting('fleet:livingroom-tv')).toEqual([{ id: 'automation:kitchen_button_1', name: 'Kitchen Button 1', kind: 'automation', source: 'home-assistant' }]);
    expect(await service.match('livingroom-tv', { queue: 'morning-program' })).toMatchObject({ id: 'automation:kitchen_button_1' });
    // cached
    await service.list({});
    expect(live.read).toHaveBeenCalledTimes(1);
  });

  it('falls back to the imported snapshot where the live config is out of reach', async () => {
    const store = snapshots();
    const live = { name: 'home-assistant', available: () => false, read: vi.fn() };
    const service = new RoutineCatalogService({ liveSources: [live], snapshots: store, clock: { now: () => Date.parse('2026-10-03T00:00:00Z') }, logger: { info: vi.fn(), warn: vi.fn() } });
    expect((await service.list({})).routines).toEqual([]);
    const imported = await service.importSnapshot({ config: haConfig, source: 'cli' });
    expect(imported).toEqual({ count: 1, dropped: 0, importedAt: '2026-10-03T00:00:00.000Z' });
    const { routines, sources } = await service.list({});
    expect(routines.map((r) => r.id)).toEqual(['automation:kitchen_button_1']);
    expect(sources.find((s) => s.kind === 'snapshot')).toMatchObject({ used: true, count: 1, from: 'cli' });
    expect(live.read).not.toHaveBeenCalled();
  });

  it('import validates: no input is an error, malformed routines are dropped', async () => {
    const service = new RoutineCatalogService({ snapshots: snapshots(), logger: { info: vi.fn() } });
    await expect(service.importSnapshot({})).rejects.toMatchObject({ code: 'INVALID_ROUTINES' });
    const result = await service.importSnapshot({ routines: [{ id: 'a', name: 'A', targets: [{ deviceId: 'fleet:x' }] }, { id: 7 }, null] });
    expect(result).toMatchObject({ count: 1, dropped: 2 });
  });

  it('adds routines only the history has seen, as observed', async () => {
    const history = { load: async () => [
      { routine: { id: null, name: 'Home Assistant' }, deviceId: 'fleet:office-tv', what: { key: 'queue', value: 'x' } },
      { routine: { id: 'automation:kitchen_button_1', name: 'Kitchen Button 1' }, deviceId: 'fleet:livingroom-tv', what: {} },
    ] };
    const live = { name: 'home-assistant', available: () => true, read: async () => haConfig };
    const service = new RoutineCatalogService({ liveSources: [live], history });
    const { routines } = await service.list({});
    expect(routines.map((r) => [r.id, r.kind])).toEqual([
      ['automation:kitchen_button_1', 'automation'],
      ['observed:home_assistant', 'observed'],
    ]);
    expect(routines[1].targets).toEqual([{ deviceId: 'fleet:office-tv', screenId: 'office-tv', query: 'queue=x' }]);
  });

  it('a routine origin seen on ledger starts (a routine driving a wall browser) is observed too', async () => {
    const playLedger = { plays: async () => [
      { deviceId: 'browser:kitchen', origin: { kind: 'routine', id: null, name: 'Morning radio' } },
      { deviceId: 'browser:kitchen', origin: { kind: 'device', id: 'browser:dad' } },
      { deviceId: 'fleet:livingroom-tv', origin: 'routine:legacy text' },
    ] };
    const service = new RoutineCatalogService({ playLedger, clock: { now: () => Date.parse('2026-10-03T00:00:00Z') } });
    const { routines } = await service.list({});
    expect(routines.map((r) => [r.id, r.name, r.targets.map((t) => t.deviceId)])).toEqual([
      ['observed:morning_radio', 'Morning radio', ['browser:kitchen']],
    ]);
    expect(await service.targeting('browser:kitchen')).toEqual([{ id: 'observed:morning_radio', name: 'Morning radio', kind: 'observed', source: 'history' }]);
  });

  it('a live read failure is logged and leaves the snapshot in charge', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() };
    const live = { name: 'home-assistant', available: () => true, read: async () => { throw new Error('EACCES'); } };
    const store = snapshots({ routines: [{ id: 's', name: 'S', targets: [{ deviceId: 'fleet:x' }] }], importedAt: 't', source: 'cli' });
    const service = new RoutineCatalogService({ liveSources: [live], snapshots: store, logger });
    expect((await service.list({})).routines.map((r) => r.id)).toEqual(['s']);
    expect(logger.warn).toHaveBeenCalledWith('media.routines.live_read_failed', expect.objectContaining({ error: 'EACCES' }));
  });
});
