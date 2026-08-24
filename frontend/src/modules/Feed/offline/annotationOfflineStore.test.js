import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  cacheAnnotations,
  cachedAnnotations,
  flushAnnotationMutations,
  queueAnnotationMutation,
  queuedAnnotationCount,
} from './annotationOfflineStore.js';

describe('annotationOfflineStore', () => {
  beforeEach(() => localStorage.clear());

  test('scopes cached notes to an item', () => {
    cacheAnnotations('one', [{ id: 'a', itemId: 'one', note: 'First', updatedAt: '2026-08-24T10:00:00Z' }]);
    cacheAnnotations('two', [{ id: 'b', itemId: 'two', note: 'Second', updatedAt: '2026-08-24T11:00:00Z' }]);

    expect(cachedAnnotations('one')).toMatchObject([{ id: 'a', note: 'First' }]);
    expect(cachedAnnotations('two')).toMatchObject([{ id: 'b', note: 'Second' }]);
  });

  test('replays queued mutations in order and retains the failed tail', async () => {
    queueAnnotationMutation({ queueId: 'one', method: 'POST', path: '/annotations', data: { note: 'First' } });
    queueAnnotationMutation({ queueId: 'two', method: 'PATCH', path: '/annotations/a', data: { note: 'Second' } });
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new TypeError('offline'));

    expect(await flushAnnotationMutations(send)).toBe(1);
    expect(send.mock.calls.map(call => call[0])).toEqual(['/annotations', '/annotations/a']);
    expect(queuedAnnotationCount()).toBe(1);
  });

  test('coalesces simultaneous replay attempts from multiple open articles', async () => {
    queueAnnotationMutation({ queueId: 'one', method: 'POST', path: '/annotations', data: { note: 'Once' } });
    let release;
    const send = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const first = flushAnnotationMutations(send);
    const second = flushAnnotationMutations(send);
    release({});

    expect(await Promise.all([first, second])).toEqual([1, 1]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(queuedAnnotationCount()).toBe(0);
  });

  test('does not write a completed replay into a different account queue', async () => {
    const tokenFor = username => `header.${btoa(JSON.stringify({ sub: username })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
    localStorage.setItem('ds_token', tokenFor('alice'));
    queueAnnotationMutation({ queueId: 'alice-note', method: 'POST', path: '/annotations', data: { note: 'Alice' } });
    localStorage.setItem('feed:annotation-queue:bob', JSON.stringify([{ queueId: 'bob-note', method: 'POST', path: '/annotations', data: { note: 'Bob' } }]));
    let release;
    const replay = flushAnnotationMutations(() => new Promise(resolve => { release = resolve; }));
    localStorage.setItem('ds_token', tokenFor('bob'));
    release({});

    expect(await replay).toBe(0);
    expect(JSON.parse(localStorage.getItem('feed:annotation-queue:alice'))).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('feed:annotation-queue:bob'))).toHaveLength(1);
  });
});
