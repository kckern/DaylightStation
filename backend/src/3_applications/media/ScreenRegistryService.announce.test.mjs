// Announce: previous browser id folded in (spot continuity), and no ghost
// registration for a browser nobody named that never played.
import { describe, it, expect, vi } from 'vitest';
import { ScreenRegistryService } from './ScreenRegistryService.mjs';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');

function memoryStore(initial = { screens: {}, aliases: {} }) {
  let state = structuredClone(initial);
  return { load: vi.fn(async () => structuredClone(state)), save: vi.fn(async (next) => { state = structuredClone(next); }), get state() { return state; } };
}

function progressStore(records) {
  const data = new Map(records.map((r) => [`${r.namespaceId}|${r.progress.contentId}`, structuredClone(r)]));
  return {
    data,
    listAllProgress: vi.fn(async () => [...data.values()].map((r) => structuredClone(r))),
    updateSpots: vi.fn(async (contentId, ns, update) => {
      const rec = data.get(`${ns}|${contentId}`);
      const next = update({ spots: { ...(rec.progress.spots || {}) }, lastDevice: rec.progress.lastDevice ?? null });
      if (!next) return false;
      rec.progress = { ...rec.progress, spots: next.spots, ...(next.lastDevice !== undefined ? { lastDevice: next.lastDevice } : {}) };
      return true;
    }),
  };
}

const build = ({ store = memoryStore(), progress = null } = {}) => new ScreenRegistryService({
  store, configuredScreens: { list: () => [] }, progress, clock: { now: () => NOW },
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
});

describe('ScreenRegistryService.announce', () => {
  it('does not register a browser nobody named until it plays', async () => {
    const store = memoryStore();
    const service = build({ store });
    expect(await service.announce({ id: 'browser:aaaa1111' })).toBe(null);
    expect(store.state.screens).toEqual({});
    const played = await service.announce({ id: 'browser:aaaa1111', playing: true });
    expect(played).toMatchObject({ id: 'browser:aaaa1111', name: 'Browser aaaa1111' });
    const named = await service.announce({ id: 'browser:bbbb2222', name: 'Kitchen tablet' });
    expect(named.name).toBe('Kitchen tablet');
  });

  it('keeps legacy placeholder ghosts out of the main list', async () => {
    const store = memoryStore({ screens: { 'browser:ghost': { name: 'Browser ghost123', lastSeen: new Date(NOW).toISOString() } }, aliases: {} });
    const view = await build({ store }).list({});
    expect(view.screens).toEqual([]);
    expect(view.unnamed.map((s) => s.id)).toEqual(['browser:ghost']);
  });

  it('folds the browser\'s previous id (and its spots) into the one it now uses', async () => {
    const progress = progressStore([
      { namespaceId: 'plex/1', progress: { contentId: 'plex:1', playhead: 50, spots: { 'browser:0123456789abcdef': { playhead: 50, lastPlayed: '2026-10-02 10:00:00' } }, lastDevice: 'browser:0123456789abcdef' } },
    ]);
    const store = memoryStore();
    const service = build({ store, progress });
    const screen = await service.announce({ id: 'browser:client-1', name: 'Kitchen tablet', previousId: 'browser:0123456789abcdef' });
    expect(screen).toMatchObject({ id: 'browser:client-1', name: 'Kitchen tablet', aliases: ['browser:0123456789abcdef'] });
    const rec = [...progress.data.values()][0].progress;
    expect(rec.spots).toEqual({ 'browser:client-1': { playhead: 50, lastPlayed: '2026-10-02 10:00:00' } });
    expect(rec.lastDevice).toBe('browser:client-1');
    expect(await service.resolve('browser:0123456789abcdef')).toBe('browser:client-1');
    // Announcing again with the same previous id is a no-op.
    await service.announce({ id: 'browser:client-1', previousId: 'browser:0123456789abcdef' });
    expect(Object.keys(store.state.aliases)).toEqual(['browser:0123456789abcdef']);
  });

  it('never folds away a named screen another device is known by', async () => {
    const store = memoryStore();
    const service = build({ store });
    await service.announce({ id: 'browser:other', name: "Dad's laptop" });
    const screen = await service.announce({ id: 'browser:client-1', name: 'Kitchen tablet', previousId: 'browser:other' });
    expect(screen.aliases).toEqual([]);
    expect(await service.resolve('browser:other')).toBe('browser:other');
  });
});
