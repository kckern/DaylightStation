import { describe, it, expect, vi } from 'vitest';
import { ScreenRegistryService } from './ScreenRegistryService.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-03T12:00:00.000Z');

function memoryStore(initial = { screens: {}, aliases: {} }) {
  let state = structuredClone(initial);
  return {
    load: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (next) => { state = structuredClone(next); }),
    get state() { return state; },
  };
}

function build(overrides = {}) {
  const store = overrides.store ?? memoryStore();
  let now = NOW;
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const service = new ScreenRegistryService({
    store,
    configuredScreens: { list: () => [
      { id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', name: 'Living Room TV', room: 'Living Room', type: 'shield-tv', wakeable: true },
    ] },
    signals: overrides.signals ?? null,
    routines: overrides.routines ?? null,
    progress: overrides.progress ?? null,
    createMediaProgress: overrides.createMediaProgress ?? ((p) => ({ ...p })),
    clock: { now: () => now },
    logger,
  });
  return { service, store, logger, advance: (ms) => { now += ms; } };
}

describe('ScreenRegistryService', () => {
  it('lists configured screens and announced browsers in one household list', async () => {
    const { service } = build();
    await service.announce({ id: 'browser:aaaa1111', name: 'Kitchen tablet' });
    const view = await service.list({});
    expect(view.screens.map((s) => [s.id, s.name])).toEqual([
      ['browser:aaaa1111', 'Kitchen tablet'],
      ['fleet:livingroom-tv', 'Living Room TV'],
    ]);
  });

  it('an announce from a known screen does not rewrite the file every time', async () => {
    const { service, store, advance } = build();
    await service.announce({ id: 'browser:a', name: 'Kitchen tablet' });
    expect(store.save).toHaveBeenCalledTimes(1);
    advance(60_000);
    const again = await service.announce({ id: 'browser:a', name: 'Kitchen tablet' });
    expect(store.save).toHaveBeenCalledTimes(1);
    // ...yet the list shows the fresh lastSeen.
    expect(again.lastSeen).toBe(new Date(NOW + 60_000).toISOString());
    advance(11 * 60_000);
    await service.announce({ id: 'browser:a' });
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('renaming a screen a routine targets needs confirmation; the routines are listed', async () => {
    const routines = { targeting: vi.fn(async (id) => (id === 'fleet:livingroom-tv' ? [{ id: 'automation:kitchen_button_1', name: 'Kitchen button 1' }] : [])) };
    const { service, store } = build({ routines });
    await expect(service.rename({ id: 'fleet:livingroom-tv', name: 'Den TV' }))
      .rejects.toMatchObject({ code: 'ROUTINES_TARGET', details: { routines: [{ id: 'automation:kitchen_button_1', name: 'Kitchen button 1' }] } });
    expect(store.save).not.toHaveBeenCalled();
    const done = await service.rename({ id: 'fleet:livingroom-tv', name: 'Den TV', confirm: true });
    expect(done.screen).toMatchObject({ id: 'fleet:livingroom-tv', name: 'Den TV', wasName: 'Living Room TV' });
    expect(done.routines).toHaveLength(1);
  });

  it('renaming a screen no routine targets goes straight through', async () => {
    const { service } = build({ routines: { targeting: async () => [] } });
    await service.announce({ id: 'browser:a', name: 'Old' });
    expect((await service.rename({ id: 'browser:a', name: 'New' })).screen.name).toBe('New');
  });

  it('retiring names the routines first, then retires on confirm', async () => {
    const routines = { targeting: vi.fn(async () => [{ id: 'automation:x', name: 'Morning' }]) };
    const { service } = build({ routines });
    await service.announce({ id: 'browser:a', name: 'Kitchen tablet' });
    await expect(service.retire({ id: 'browser:a' })).rejects.toMatchObject({ code: 'ROUTINES_TARGET' });
    const done = await service.retire({ id: 'browser:a', confirm: true });
    expect(done.screen.retiredAt).toBe(new Date(NOW).toISOString());
    expect((await service.list({})).retired.map((s) => s.id)).toEqual(['browser:a']);
  });

  it('merging moves the duplicate\'s spots onto the screen it merges into (newest spot wins)', async () => {
    const saved = [];
    const records = [
      { namespaceId: 'plex/1', progress: { contentId: 'plex:1', playhead: 10, spots: { 'browser:new': { playhead: 50, lastPlayed: '2026-10-02 10:00:00' }, 'browser:old': { playhead: 5, lastPlayed: '2026-10-01 10:00:00' } }, lastDevice: 'browser:new' } },
      { namespaceId: 'plex/1', progress: { contentId: 'plex:2', playhead: 10, spots: { 'browser:old': { playhead: 7, lastPlayed: '2026-10-02 10:00:00' }, 'browser:new': { playhead: 1, lastPlayed: '2026-09-01 10:00:00' } }, lastDevice: 'browser:old' } },
      { namespaceId: 'plex/1', progress: { contentId: 'plex:3', playhead: 1, spots: { 'fleet:livingroom-tv': { playhead: 1, lastPlayed: 't' } } } },
    ];
    const progress = {
      listAllProgress: vi.fn(async () => records),
      saveProgress: vi.fn(async (state, ns) => { saved.push({ state, ns }); }),
    };
    const { service } = build({ progress });
    await service.announce({ id: 'browser:old', name: 'Kitchen tablet' });
    await service.announce({ id: 'browser:new', name: 'Kitchen tablet again' });
    const result = await service.merge({ fromId: 'browser:new', intoId: 'browser:old' });
    expect(result.movedSpots).toBe(2);
    expect(saved).toHaveLength(2);
    expect(saved[0].state.spots).toEqual({ 'browser:old': { playhead: 50, lastPlayed: '2026-10-02 10:00:00' } });
    expect(saved[0].state.lastDevice).toBe('browser:old');
    expect(saved[1].state.spots).toEqual({ 'browser:old': { playhead: 7, lastPlayed: '2026-10-02 10:00:00' } });
    expect(await service.aliasesOf('browser:old')).toEqual(['browser:old', 'browser:new']);
    expect(await service.resolve('browser:new')).toBe('browser:old');
  });

  it('a spot move failure is logged and the merge still stands', async () => {
    const progress = { listAllProgress: vi.fn(async () => { throw new Error('disk'); }), saveProgress: vi.fn() };
    const { service, logger } = build({ progress });
    await service.announce({ id: 'browser:old', name: 'A' });
    await service.announce({ id: 'browser:new', name: 'B' });
    const result = await service.merge({ fromId: 'browser:new', intoId: 'browser:old' });
    expect(result.movedSpots).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('media.screens.spot_move_failed', expect.objectContaining({ error: 'disk' }));
  });

  it('live signals feed lastSeen/online, and quiet screens fold away', async () => {
    const signals = { read: vi.fn(async () => ({ 'fleet:livingroom-tv': { lastSeen: new Date(NOW - 40 * DAY).toISOString(), online: false } })) };
    const { service } = build({ signals });
    const view = await service.list({});
    expect(view.notSeenLately.map((s) => s.id)).toEqual(['fleet:livingroom-tv']);
  });

  it('nameOf answers the human name for any id, following merges; unknown is null', async () => {
    const { service } = build();
    await service.announce({ id: 'browser:a', name: 'Kitchen tablet' });
    expect(await service.nameOf('browser:a')).toBe('Kitchen tablet');
    expect(await service.nameOf('fleet:livingroom-tv')).toBe('Living Room TV');
    expect(await service.nameOf('livingroom-tv')).toBe('Living Room TV');
    expect(await service.nameOf('browser:zzz')).toBeNull();
  });

  it('writes are logged', async () => {
    const { service, logger } = build();
    await service.add({ name: 'Garage tablet', room: 'Garage' });
    expect(logger.info).toHaveBeenCalledWith('media.screens.added', expect.objectContaining({ id: 'screen:garage-tablet' }));
  });
});
