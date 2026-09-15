import { describe, expect, it } from 'vitest';
import {
  validatePlaybackOwnerIdentity,
  validatePlaybackOwnerSessionSnapshot,
} from './playback-owner.mjs';

const identity = {
  ownerInstanceId: 'owner-1',
  playbackRevision: 2,
  queueRevision: 3,
  sessionId: 'session-1',
  contentId: 'plex:a',
  queueItemId: 'entry-a',
};

const snapshot = {
  sessionId: 'session-1',
  state: 'paused',
  currentItem: { contentId: 'plex:a', format: 'video' },
  position: 12,
  queue: {
    items: [
      { queueItemId: 'entry-a', contentId: 'plex:a', format: 'video', priority: 'queue' },
      { queueItemId: 'entry-b', contentId: 'plex:b', format: 'video', priority: 'upNext' },
      { queueItemId: 'entry-a-2', contentId: 'plex:a', format: 'video', priority: 'queue' },
    ],
    currentIndex: 0,
    upNextCount: 1,
    executionOrder: ['entry-a', 'entry-b', 'entry-a-2'],
  },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'screen-1', updatedAt: '2026-09-14T00:00:00.000Z', playbackOwner: identity },
};

describe('playback owner contract', () => {
  it('accepts a finite owner identity and a lossless execution order with duplicate content entries', () => {
    expect(validatePlaybackOwnerIdentity(identity)).toEqual({ valid: true, errors: [] });
    expect(validatePlaybackOwnerSessionSnapshot(snapshot)).toEqual({ valid: true, errors: [] });
  });

  it('rejects malformed revisions and execution order that does not begin at the current entry', () => {
    expect(validatePlaybackOwnerIdentity({ ...identity, queueRevision: Number.NaN }).valid).toBe(false);
    expect(validatePlaybackOwnerSessionSnapshot({
      ...snapshot,
      queue: { ...snapshot.queue, executionOrder: ['entry-b', 'entry-a-2'] },
    }).valid).toBe(false);
  });

  it('accepts legacy snapshots that omit additive owner and execution-order fields', () => {
    const legacy = structuredClone(snapshot);
    delete legacy.meta.playbackOwner;
    delete legacy.queue.executionOrder;
    expect(validatePlaybackOwnerSessionSnapshot(legacy)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['duplicate queue IDs', (value) => { value.queue.items[2].queueItemId = 'entry-a'; }],
    ['out-of-range current index', (value) => { value.queue.currentIndex = 99; }],
    ['missing order for a current entry', (value) => { value.queue.executionOrder = []; }],
    ['owner session mismatch', (value) => { value.meta.playbackOwner.sessionId = 'another-session'; }],
    ['owner session mismatch without a current entry', (value) => {
      value.queue.currentIndex = -1;
      value.queue.executionOrder = [];
      value.meta.playbackOwner.sessionId = 'another-session';
      value.meta.playbackOwner.contentId = null;
      value.meta.playbackOwner.queueItemId = null;
    }],
    ['owner entry mismatch', (value) => { value.meta.playbackOwner.queueItemId = 'entry-b'; value.meta.playbackOwner.contentId = 'plex:b'; }],
  ])('rejects %s', (_label, mutate) => {
    const malformed = structuredClone(snapshot);
    mutate(malformed);
    expect(validatePlaybackOwnerSessionSnapshot(malformed).valid).toBe(false);
  });

  it('allows repeated visits but not repeated entry IDs', () => {
    const repeatedVisit = structuredClone(snapshot);
    repeatedVisit.queue.executionOrder = ['entry-a', 'entry-b', 'entry-a-2', 'entry-a'];
    expect(validatePlaybackOwnerSessionSnapshot(repeatedVisit).valid).toBe(true);
  });
});
