// Compatibility gate: a PersistedSession blob written by the PREVIOUS app
// generation must hydrate byte-for-byte into this one (schema v1 is a
// contract — docs/reference/media/media-app-technical.md §11.2). If this
// test breaks, you changed the persisted shape: bump the schema and write a
// migration instead.
import { describe, it, expect, beforeEach } from 'vitest';
import { readPersistedSession, writePersistedSession, PERSIST_KEY } from './persistence.js';
import { createLocalSessionController } from './LocalSessionController.js';

// Captured from the pre-rebuild app (same shape the old persistence.js
// serialized): full SessionSnapshot with queue, config, meta.
const LEGACY_BLOB = JSON.stringify({
  schemaVersion: 1,
  sessionId: '7e93f6a2-1f7b-4f6e-9a51-1b2c3d4e5f60',
  updatedAt: '2026-06-09T21:14:02.123Z',
  wasPlayingOnUnload: true,
  snapshot: {
    sessionId: '7e93f6a2-1f7b-4f6e-9a51-1b2c3d4e5f60',
    state: 'playing',
    currentItem: {
      contentId: 'plex-main:649319',
      format: 'video',
      title: 'Lonesome Dove',
      duration: 5400,
      thumbnail: '/api/v1/display/plex-main/649319',
    },
    position: 1422.5,
    queue: {
      items: [
        {
          queueItemId: 'q-1', contentId: 'plex-main:649319', title: 'Lonesome Dove',
          format: 'video', duration: 5400, thumbnail: '/api/v1/display/plex-main/649319',
          addedAt: '2026-06-09T20:00:00.000Z', priority: 'queue',
        },
        {
          queueItemId: 'q-2', contentId: 'plex-main:649320', title: 'Lonesome Dove Pt 2',
          format: 'video', duration: 5400, thumbnail: null,
          addedAt: '2026-06-09T20:00:05.000Z', priority: 'upNext',
        },
      ],
      currentIndex: 0,
      upNextCount: 1,
    },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 80, playbackRate: 1 },
    meta: { ownerId: 'client-abc', updatedAt: '2026-06-09T21:14:02.123Z' },
  },
});

beforeEach(() => localStorage.clear());

describe('PersistedSession v1 compatibility', () => {
  it('hydrates a legacy blob intact', () => {
    localStorage.setItem(PERSIST_KEY, LEGACY_BLOB);
    const read = readPersistedSession();
    expect(read).not.toBe('schema-mismatch');
    expect(read.wasPlayingOnUnload).toBe(true);
    expect(read.snapshot.position).toBe(1422.5);
    expect(read.snapshot.queue.items).toHaveLength(2);
    expect(read.snapshot.queue.upNextCount).toBe(1);
    expect(read.snapshot.config.volume).toBe(80);
  });

  it('the controller resumes from the legacy snapshot', () => {
    localStorage.setItem(PERSIST_KEY, LEGACY_BLOB);
    const read = readPersistedSession();
    const c = createLocalSessionController({ clientId: 'client-abc', persistedSnapshot: read.snapshot });
    expect(c.getSnapshot().currentItem.contentId).toBe('plex-main:649319');
    expect(c.getSnapshot().queue.currentIndex).toBe(0);
    expect(c.position.get().seconds).toBe(1422.5);
  });

  it('a write round-trips through read with the same field set', () => {
    localStorage.setItem(PERSIST_KEY, LEGACY_BLOB);
    const { snapshot } = readPersistedSession();
    writePersistedSession(snapshot, { wasPlayingOnUnload: true });
    const reread = JSON.parse(localStorage.getItem(PERSIST_KEY));
    expect(Object.keys(reread).sort()).toEqual(
      ['schemaVersion', 'sessionId', 'snapshot', 'updatedAt', 'wasPlayingOnUnload']
    );
    expect(reread.schemaVersion).toBe(1);
    expect(reread.snapshot).toEqual(snapshot);
  });

  it('unknown schema versions are reported as mismatch, not crashes', () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ schemaVersion: 99, snapshot: {} }));
    expect(readPersistedSession()).toBe('schema-mismatch');
  });
});
