import { describe, it, expect } from 'vitest';
import {
  validateSessionSnapshot,
  validateQueueSnapshot,
  validateQueueItem,
  validatePlayableItem,
  createEmptyQueueSnapshot,
  createIdleSessionSnapshot,
} from './shapes.mjs';

describe('shape validators', () => {
  it('accepts a minimal valid SessionSnapshot', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    expect(validateSessionSnapshot(snap).valid).toBe(true);
  });

  it('keeps legacy snapshots compatible but rejects malformed optional owner metadata', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    expect(validateSessionSnapshot(snap).valid).toBe(true);
    snap.meta.playbackOwner = {
      ownerInstanceId: 'owner-1', playbackRevision: 1.5, queueRevision: 0,
      sessionId: 's1', contentId: null, queueItemId: null,
    };
    expect(validateSessionSnapshot(snap).valid).toBe(false);
  });

  it('rejects a SessionSnapshot with an invalid state', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    snap.state = 'DANCING';
    const r = validateSessionSnapshot(snap);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('state'))).toBe(true);
  });

  it('accepts hls_video as a playable session format', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    snap.state = 'paused';
    snap.currentItem = { contentId: 'plex:hls', format: 'hls_video' };
    expect(validateSessionSnapshot(snap).valid).toBe(true);
  });

  it('rejects a SessionSnapshot with an out-of-range volume', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    snap.config.volume = 150;
    expect(validateSessionSnapshot(snap).valid).toBe(false);
  });

  it('validates an empty queue snapshot', () => {
    expect(validateQueueSnapshot(createEmptyQueueSnapshot()).valid).toBe(true);
  });

  it('rejects a QueueItem without contentId', () => {
    const r = validateQueueItem({ queueItemId: 'q1', title: 't' });
    expect(r.valid).toBe(false);
  });

  it('rejects a PlayableItem without contentId', () => {
    expect(validatePlayableItem({ format: 'video' }).valid).toBe(false);
  });

  it('accepts a valid PlayableItem', () => {
    const p = { contentId: 'plex-main:1', format: 'video', title: 'Test' };
    expect(validatePlayableItem(p).valid).toBe(true);
  });
});
