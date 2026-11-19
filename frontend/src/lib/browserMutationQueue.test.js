import { afterEach, expect, it, vi } from 'vitest';
import { createBrowserMutationQueue } from './browserMutationQueue.js';

const queue = () => createBrowserMutationQueue({ prefix: 'test:queue:', getOwner: () => 'reader', idOf: row => row.id });

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('retains the queue and reports a refused native lock without sending, then retries', async () => {
  const denied = new DOMException('Storage partition unavailable', 'SecurityError');
  const request = vi.fn().mockRejectedValueOnce(denied).mockImplementation((name, options, run) => run({ name }));
  vi.stubGlobal('navigator', { locks: { request } });
  const mutations = queue();
  const operation = { id: 'queued' };
  const send = vi.fn().mockResolvedValue('receipt');
  const onError = vi.fn();
  const onDequeue = vi.fn();
  mutations.enqueue('reader', operation);

  expect(await mutations.flush('reader', send, { onError })).toBe(0);
  expect(onError.mock.calls).toEqual([[denied, undefined]]);
  expect(send).not.toHaveBeenCalled();
  expect(mutations.snapshot()).toEqual([operation]);
  expect(await mutations.flush('reader', send, { onDequeue })).toBe(1);
  expect(send.mock.calls).toEqual([[operation]]);
  expect(onDequeue.mock.calls).toEqual([[[], operation, 'receipt']]);
});

it('shares an in-tab flush when Web Locks are unavailable', async () => {
  vi.stubGlobal('navigator', {});
  const mutations = queue();
  const finish = Promise.withResolvers();
  const send = vi.fn(() => finish.promise);
  mutations.enqueue('reader', { id: 'queued' });
  const first = mutations.flush('reader', send);
  const second = mutations.flush('reader', send);
  finish.resolve('accepted');
  expect(await Promise.all([first, second])).toEqual([1, 1]);
  expect(send).toHaveBeenCalledOnce();
  expect(mutations.snapshot()).toEqual([]);
});

it('checks the active owner after a delayed native grant and lets other queues drain independently', async () => {
  const grant = Promise.withResolvers();
  const waiting = Promise.withResolvers();
  const request = (name, options, run) => {
    if (name === 'items:alice') {
      waiting.resolve();
      return grant.promise.then(() => run({ name }));
    }
    return run({ name });
  };
  vi.stubGlobal('navigator', { locks: { request } });
  let owner = 'alice';
  const make = prefix => createBrowserMutationQueue({ prefix, getOwner: () => owner, idOf: row => row.id });
  const items = make('items:');
  const notes = make('notes:');
  const send = vi.fn();
  items.enqueue('alice', { id: 'alice-item' });
  notes.enqueue('alice', { id: 'alice-note' });
  const held = items.flush('alice', send);
  await waiting.promise;
  expect(await notes.flush('alice', send)).toBe(1);
  owner = 'bob';
  items.enqueue('bob', { id: 'bob-item' });
  expect(await items.flush('bob', send)).toBe(1);
  grant.resolve();
  expect(await held).toBe(0);
  expect(send.mock.calls).toEqual([[{ id: 'alice-note' }], [{ id: 'bob-item' }]]);
  owner = 'alice';
  expect(items.snapshot()).toEqual([{ id: 'alice-item' }]);
});

it('leaves a failed holder’s operation pending for an explicit later retry', async () => {
  let occupied = false;
  const request = async (name, options, run) => {
    expect(options).toEqual({ ifAvailable: true });
    if (occupied) return run(null);
    occupied = true;
    try { return await run({ name }); }
    finally { occupied = false; }
  };
  vi.stubGlobal('navigator', { locks: { request } });
  const first = queue();
  const contender = queue();
  const operation = { id: 'pending' };
  first.enqueue('reader', operation);
  const finish = Promise.withResolvers();
  const error = new TypeError('offline');
  const onError = vi.fn();
  const secondSend = vi.fn().mockResolvedValue('success');
  const held = first.flush('reader', () => finish.promise, { onError });
  expect(await contender.flush('reader', secondSend)).toBe(0);
  expect(secondSend).not.toHaveBeenCalled();
  finish.reject(error);
  expect(await held).toBe(0);
  expect(onError.mock.calls).toEqual([[error, operation]]);
  expect(contender.snapshot()).toEqual([operation]);
  expect(await contender.flush('reader', secondSend)).toBe(1);
  expect(secondSend).toHaveBeenCalledOnce();
  expect(contender.snapshot()).toEqual([]);
});
