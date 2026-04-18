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

  it('rejects a SessionSnapshot with an invalid state', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    snap.state = 'DANCING';
    const r = validateSessionSnapshot(snap);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('state'))).toBe(true);
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
