import test from 'node:test';
import assert from 'node:assert/strict';

import { createVolumeStore } from '../volumeStorage.js';

function makeMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

function makeThrowingStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem() {
      throw new Error('write-fail');
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

function makeTickingNow() {
  let tick = 0;
  return () => {
    tick += 1;
    return tick;
  };
}

test('fallback ordering prefers exact, then season sibling, then show sibling, then global', () => {
  const store = createVolumeStore({ storage: null, now: makeTickingNow() });
  store.setVolume({ showId: 'show', seasonId: 'S1', trackId: 'T1' }, { level: 0.2 });
  store.setVolume({ showId: 'show', seasonId: 'S1', trackId: 'T2' }, { level: 0.3 });
  store.setVolume({ showId: 'show', seasonId: 'S2', trackId: 'T3' }, { level: 0.4 });

  const seasonSibling = store.getVolume({ showId: 'show', seasonId: 'S1', trackId: 'missing' });
  assert.equal(seasonSibling.level, 0.3);
  assert.equal(seasonSibling.source, 'season-sibling');

  const showSibling = store.getVolume({ showId: 'show', seasonId: 'S9', trackId: 'missing' });
  assert.equal(showSibling.level, 0.4);
  assert.equal(showSibling.source, 'show-sibling');

  const globalFallback = store.getVolume({ showId: 'other', seasonId: 'S1', trackId: 'missing' });
  assert.equal(globalFallback.level, 0.6);
  assert.equal(globalFallback.source, 'global');
});

test('exact match wins even when siblings are fresher', () => {
  const store = createVolumeStore({ storage: null, now: makeTickingNow() });
  store.setVolume({ showId: 'show', seasonId: 'S1', trackId: 'T1' }, { level: 0.1 });
  store.setVolume({ showId: 'show', seasonId: 'S1', trackId: 'T2' }, { level: 0.9 });

  const exact = store.getVolume({ showId: 'show', seasonId: 'S1', trackId: 'T1' });
  assert.equal(exact.level, 0.1);
  assert.equal(exact.source, 'exact');
});

test('malformed storage entries are ignored and fallback to in-memory default global', () => {
  const storage = makeMemoryStorage({
    'volume:fitness:show:season:track': 'not-json',
    'volume:global': JSON.stringify({ level: 0.4, muted: false, updatedAt: 2 }),
  });
  const store = createVolumeStore({ storage });

  const result = store.getVolume({ showId: 'show', seasonId: 'season', trackId: 'track' });
  assert.equal(result.level, 0.6); // stored global is ignored; defaults stay in-memory only
  assert.equal(result.source, 'global');
});

test('missing identity never writes global and echoes fallback', () => {
  const storage = makeMemoryStorage();
  const store = createVolumeStore({ storage, now: makeTickingNow() });

  const resolved = store.setVolume({ showId: null, seasonId: null, trackId: null }, { level: 0.1 });
  assert.equal(resolved.level, 0.6);
  assert.equal(storage.length, 0); // nothing persisted when identity is missing
});

test('write failures still update memory and only log once', () => {
  const errors = [];
  const storage = makeThrowingStorage();
  const store = createVolumeStore({
    storage,
    onStorageError: (err) => errors.push(err.message),
    now: makeTickingNow(),
  });

  const first = store.setVolume({ showId: 's', seasonId: 'a', trackId: 't1' }, { level: 0.2, muted: true });
  assert.equal(first.level, 0.2);
  assert.equal(first.muted, true);

  const second = store.setVolume({ showId: 's', seasonId: 'a', trackId: 't2' }, { level: 0.5, muted: false });
  assert.equal(second.level, 0.5);

  const resolved = store.getVolume({ showId: 's', seasonId: 'a', trackId: 't1' });
  assert.equal(resolved.level, 0.2);
  assert.equal(resolved.source, 'exact');
  assert.equal(store.isStorageHealthy(), false);
  assert.equal(errors.length, 1);
});
