import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  cacheAnnotations,
  cachedAnnotations,
  flushAnnotationMutations,
  queueAnnotationMutation,
  queuedAnnotationCount,
} from "./annotationOfflineStore.js";

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

  test('sends an operation appended while a previous send is pending', async () => {
    queueAnnotationMutation({ queueId: 'first', method: 'POST', path: '/first' });
    let release;
    const send = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({});
    const flush = flushAnnotationMutations(send);
    queueAnnotationMutation({ queueId: 'second', method: 'PATCH', path: '/second' });
    release();
    expect(await flush).toBe(2);
    expect(send.mock.calls.map(([path]) => path)).toEqual(['/first', '/second']);
    expect(queuedAnnotationCount()).toBe(0);
  });

  test('retries local cleanup without resending an acknowledged create', async () => {
    queueAnnotationMutation({ queueId: 'cleanup', method: 'POST', path: '/notes' });
    const send = vi.fn().mockResolvedValue({});
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      expect(await flushAnnotationMutations(send)).toBe(0);
      expect(queuedAnnotationCount()).toBe(1);
    } finally { write.mockRestore(); }
    expect(await flushAnnotationMutations(send)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('rejects a full or unreadable queue without replacing its contents', () => {
    const key = 'feed:annotation-queue:household';
    for (const raw of [JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ queueId: String(i) }))), 'corrupt']) {
      localStorage.setItem(key, raw);
      expect(() => queueAnnotationMutation({ queueId: 'new' })).toThrow();
      expect(localStorage.getItem(key)).toBe(raw);
    }
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
