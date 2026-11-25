import { describe, it, expect } from 'vitest';
import { clipContext, clipKey, clipWork } from './clipContext.js';

const entry = (id, title, subtitle) => ({ queueItemId: `g-${id}`, contentId: id, title, subtitle });

// A fake Player handle over a three-clip queue, current at `position`.
function handleAt(position, { order } = {}) {
  const items = [
    entry('plex:1#1', 'First Carol', 'Winter Concert (2001)'),
    entry('plex:2#4', 'Second Carol', 'Snow Concert (2002)'),
    entry('plex:3#2', 'Third Carol', 'Frost Concert (2003)'),
  ];
  const executionOrder = order ?? items.slice(position).map((i) => i.queueItemId);
  return {
    getNowPlaying: () => ({ item: null, isQueue: true, queuePosition: position, queueLength: items.length }),
    getQueueSnapshot: () => ({ items, currentIndex: position, executionOrder }),
  };
}

const CLIP = { id: 'plex:1#1', title: 'First Carol', segment: { start: 10, end: 200 } };

describe('clipContext', () => {
  it('is null for an item without a segment window', () => {
    expect(clipContext({ id: 'plex:1' }, handleAt(0))).toBeNull();
    expect(clipContext(null, handleAt(0))).toBeNull();
  });

  it('is null for a window that does not move forward', () => {
    expect(clipContext({ segment: { start: 50, end: 50 } }, handleAt(0))).toBeNull();
    expect(clipContext({ segment: { start: 60, end: 20 } }, handleAt(0))).toBeNull();
    expect(clipContext({ segment: { start: 'a', end: 20 } }, handleAt(0))).toBeNull();
  });

  it('carries the window, queue position, length and the next clip', () => {
    expect(clipContext(CLIP, handleAt(0))).toEqual({
      segment: { start: 10, end: 200 },
      title: 'First Carol',
      work: 'plex:1',
      index: 0,
      total: 3,
      next: { title: 'Second Carol', subtitle: 'Snow Concert (2002)', work: 'plex:2', workTitle: null, workYear: null },
    });
  });

  it('follows the execution order for the next clip', () => {
    const handle = handleAt(0, { order: ['g-plex:1#1', 'g-plex:3#2', 'g-plex:2#4'] });
    expect(clipContext(CLIP, handle).next).toMatchObject({ title: 'Third Carol', subtitle: 'Frost Concert (2003)', work: 'plex:3' });
  });

  it('has no next clip at the end of the queue', () => {
    const ctx = clipContext({ ...CLIP, id: 'plex:3#2' }, handleAt(2));
    expect(ctx).toMatchObject({ index: 2, total: 3, next: null });
  });

  it('still gives the window when the handle has no queue to read', () => {
    const bare = { segment: { start: 10, end: 200 }, title: 'First Carol', work: 'plex:1', index: null, total: null, next: null };
    expect(clipContext(CLIP, {})).toEqual(bare);
    expect(clipContext(CLIP, null)).toEqual(bare);
    const throwing = { getNowPlaying: () => { throw new Error('x'); }, getQueueSnapshot: () => { throw new Error('y'); } };
    expect(clipContext(CLIP, throwing)).toMatchObject({ index: null, total: null, next: null });
  });
});

describe('clipContext: the concert a clip is from', () => {
  it('names the next clip\'s concert from its own surround piece', () => {
    const items = [
      { queueItemId: 'a', contentId: 'plex:1#1', title: 'First Carol' },
      { queueItemId: 'b', contentId: 'plex:9#3', title: 'Far Carol', subtitle: 'Far Concert (1999)', surround: { piece: { title: 'Far Concert', year: 1999 } } },
    ];
    const handle = {
      getNowPlaying: () => ({ queuePosition: 0, queueLength: 2 }),
      getQueueSnapshot: () => ({ items, executionOrder: ['a', 'b'] }),
    };
    expect(clipContext(CLIP, handle).next).toEqual({
      title: 'Far Carol', subtitle: 'Far Concert (1999)', work: 'plex:9', workTitle: 'Far Concert', workYear: 1999,
    });
  });

  it('strips only the per-clip suffix from the work id', () => {
    expect(clipWork({ contentId: 'plex:619381#21' })).toBe('plex:619381');
    expect(clipWork({ id: 'plex:5' })).toBe('plex:5');
    expect(clipWork(null)).toBeNull();
  });
});

describe('clipKey', () => {
  it('changes only when something the band shows changes', () => {
    const a = clipContext(CLIP, handleAt(0));
    const b = clipContext(CLIP, handleAt(0));
    expect(clipKey(a)).toBe(clipKey(b));
    expect(clipKey(a)).not.toBe(clipKey(clipContext(CLIP, handleAt(1))));
    expect(clipKey(null)).toBe('');
  });
});
