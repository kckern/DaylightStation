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

  test('keeps acknowledged edits and deletes cached when replay runs from another item', async () => {
    const first = { id: 'first', itemId: 'story', note: 'Original' };
    const second = { id: 'second', itemId: 'story', note: 'Remove me' };
    cacheAnnotations('story', [first, second]);
    cacheAnnotations('other', [{ id: 'other', itemId: 'other' }]);
    queueAnnotationMutation({ queueId: 'patch', method: 'PATCH', path: '/api/v1/feed/annotations/first', data: { note: 'Revised' } });
    queueAnnotationMutation({ queueId: 'delete', method: 'DELETE', path: '/api/v1/feed/annotations/second' });
    const saved = { ...first, note: 'Server revision' };
    const send = vi.fn().mockResolvedValueOnce({ annotation: saved }).mockResolvedValueOnce({ removed: true });
    expect(await flushAnnotationMutations(send)).toBe(2);
    expect(cachedAnnotations('story')).toEqual([saved]);
    expect(cachedAnnotations('other')).toEqual([{ id: 'other', itemId: 'other' }]);
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
    const saved = { id: 'accepted', itemId: 'story', note: 'Acknowledged note' };
    const send = vi.fn().mockResolvedValue({ annotation: saved });
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      expect(await flushAnnotationMutations(send)).toBe(0);
      expect(queuedAnnotationCount()).toBe(1);
    } finally { write.mockRestore(); }
    expect(await flushAnnotationMutations(send)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(cachedAnnotations('story')).toEqual([saved]);
  });

  test('rejects a full or unreadable queue without replacing its contents', () => {
    const key = 'feed:annotation-queue:household';
    for (const raw of [JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ queueId: String(i) }))), 'corrupt']) {
      localStorage.setItem(key, raw);
      expect(() => queueAnnotationMutation({ queueId: 'new' })).toThrow();
      expect(localStorage.getItem(key)).toBe(raw);
    }
  });

  test('retains the canonical acknowledgement until the submitting account returns', async () => {
    const switchTo = owner => localStorage.setItem('ds_token', 'header.' + btoa(JSON.stringify({ sub: owner })) + '.signature');
    switchTo('first');
    const prior = { id: 'note', itemId: 'story', note: 'Original' };
    const saved = { ...prior, note: 'Server revision' };
    cacheAnnotations('story', [prior]);
    queueAnnotationMutation({ queueId: 'held', method: 'PATCH', path: '/api/v1/feed/annotations/note', data: { note: 'Edit' } });
    let finish;
    const send = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const replay = flushAnnotationMutations(send);
    switchTo('second');
    finish({ annotation: saved });
    expect(await replay).toBe(0);
    expect(cachedAnnotations('story')).toEqual([]);
    switchTo('first');
    expect(await flushAnnotationMutations(send)).toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect(cachedAnnotations('story')).toEqual([saved]);
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
