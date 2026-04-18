import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
  PERSIST_KEY,
  PERSIST_SCHEMA_VERSION,
} from './persistence.js';

function makeSnapshot() {
  return {
    sessionId: 's1',
    state: 'paused',
    currentItem: { contentId: 'plex:1', format: 'video', title: 'T', duration: 60 },
    position: 12.5,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId: 'c1', updatedAt: new Date().toISOString() },
  };
}

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('round-trips a SessionSnapshot under PERSIST_KEY with schemaVersion', () => {
    writePersistedSession(makeSnapshot(), { wasPlayingOnUnload: true });
    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(PERSIST_SCHEMA_VERSION);
    expect(parsed.wasPlayingOnUnload).toBe(true);
    expect(parsed.snapshot.sessionId).toBe('s1');

    const loaded = readPersistedSession();
    expect(loaded.snapshot.sessionId).toBe('s1');
    expect(loaded.wasPlayingOnUnload).toBe(true);
  });

  it('clearPersistedSession removes only media-app.session', () => {
    writePersistedSession(makeSnapshot(), { wasPlayingOnUnload: false });
    localStorage.setItem('unrelated', 'keep-me');
    clearPersistedSession();
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep-me');
  });

  it('read returns null when nothing is persisted', () => {
    expect(readPersistedSession()).toBeNull();
  });
});

describe('persistence — schema + quota', () => {
  beforeEach(() => { localStorage.clear(); });

  it("returns 'schema-mismatch' when stored version does not match", () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ schemaVersion: 99, snapshot: {} }));
    expect(readPersistedSession()).toBe('schema-mismatch');
  });

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(PERSIST_KEY, '{not-json');
    expect(readPersistedSession()).toBeNull();
  });

  it('truncates past-played items and retries on QuotaExceededError', () => {
    const snap = {
      sessionId: 's2',
      state: 'playing',
      currentItem: { contentId: 'plex:2', format: 'video' },
      position: 0,
      queue: {
        items: [
          { queueItemId: 'a', contentId: 'p:a', priority: 'queue' },
          { queueItemId: 'b', contentId: 'p:b', priority: 'queue' },
          { queueItemId: 'c', contentId: 'p:c', priority: 'queue' },
        ],
        currentIndex: 2,
        upNextCount: 0,
      },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: 'x' },
    };

    let callCount = 0;
    const originalSetItem = window.localStorage.setItem;
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(function (k, v) {
      callCount += 1;
      if (callCount === 1) {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return originalSetItem.call(this, k, v);
    });

    const result = writePersistedSession(snap, { wasPlayingOnUnload: true });
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
    const loaded = readPersistedSession();
    expect(loaded.snapshot.queue.items).toHaveLength(1); // a, b truncated
    expect(loaded.snapshot.queue.items[0].queueItemId).toBe('c');
    expect(loaded.snapshot.queue.currentIndex).toBe(0);
    vi.restoreAllMocks();
  });
});
