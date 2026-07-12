import { describe, it, expect } from 'vitest';
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';

function fakeIO(initial = {}) {
  const disk = { 'history/triggers/nfc.observed': initial };
  return {
    loadFile: (p) => disk[p],
    saveFile: (p, data) => { disk[p] = data; },
    _disk: disk,
  };
}

describe('YamlObservedStateStore', () => {
  it('records first_seen + last_seen + count on first sight', async () => {
    const io = fakeIO();
    const store = new YamlObservedStateStore(io);
    store.load();
    const r = await store.record('aa', '2026-07-11 10:00:00');
    expect(r).toEqual({ first_seen: '2026-07-11 10:00:00', last_seen: '2026-07-11 10:00:00', count: 1 });
    expect(io._disk['history/triggers/nfc.observed'].aa.count).toBe(1);
  });

  it('preserves first_seen and bumps last_seen + count on re-sight', async () => {
    const io = fakeIO({ aa: { first_seen: '2026-07-01 09:00:00', last_seen: '2026-07-01 09:00:00', count: 3 } });
    const store = new YamlObservedStateStore(io);
    store.load();
    const r = await store.record('aa', '2026-07-11 10:00:00');
    expect(r.first_seen).toBe('2026-07-01 09:00:00');
    expect(r.last_seen).toBe('2026-07-11 10:00:00');
    expect(r.count).toBe(4);
  });

  it('has() reflects the loaded cache', () => {
    const store = new YamlObservedStateStore(fakeIO({ bb: { first_seen: 'x', last_seen: 'x', count: 1 } }));
    store.load();
    expect(store.has('bb')).toBe(true);
    expect(store.has('zz')).toBe(false);
  });
});
