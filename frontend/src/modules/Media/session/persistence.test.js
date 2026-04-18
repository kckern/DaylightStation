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
