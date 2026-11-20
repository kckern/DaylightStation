import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const chunk = { sessionId: 'fixture', seq: 1, week: '2026-W47', blob: new Blob(['audio']) };

function pretendDatabase({ abortWrite } = {}) {
  return {
    close: vi.fn(),
    transaction: vi.fn(() => {
      const tx = { objectStore: () => ({ put() {
        const request = {};
        queueMicrotask(() => {
          request.onsuccess?.();
          if (abortWrite) {
            tx.error = abortWrite;
            tx.onabort?.();
          } else tx.oncomplete?.();
        });
        return request;
      } }) };
      return tx;
    }),
  };
}

function setOpen() {
  const requests = [];
  const open = vi.fn(() => {
    const request = {};
    requests.push(request);
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  return { open, requests };
}

function succeed(request, database) {
  request.result = database;
  request.onsuccess();
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

it('shares a fresh recording database open after a rejected open', async () => {
  const { open, requests } = setOpen();
  const { putChunk } = await import('./chunkDb.js');
  const first = putChunk(chunk);
  const failure = new DOMException('Temporary open failure', 'UnknownError');
  requests[0].error = failure;
  requests[0].onerror();
  await expect(first).rejects.toBe(failure);

  const retry = Promise.allSettled([putChunk(chunk), putChunk({ ...chunk, seq: 2 })]);
  expect(open).toHaveBeenCalledTimes(2);
  const database = pretendDatabase();
  succeed(requests[1], database);
  expect((await retry).map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(database.transaction).toHaveBeenCalledTimes(2);
});

it('rejects a recording write if the transaction aborts after its request succeeds', async () => {
  const { requests } = setOpen();
  const { putChunk } = await import('./chunkDb.js');
  const aborted = new DOMException('Commit failed', 'QuotaExceededError');
  const write = putChunk(chunk);
  succeed(requests[0], pretendDatabase({ abortWrite: aborted }));
  await expect(write).rejects.toBe(aborted);
});

it('closes a late blocked connection and reopens after the live connection is retired', async () => {
  const { open, requests } = setOpen();
  const { putChunk } = await import('./chunkDb.js');
  const blocked = putChunk(chunk);
  expect(requests[0].onblocked).toBeTypeOf('function');
  requests[0].onblocked();
  await expect(blocked).rejects.toThrow();

  const retry = putChunk(chunk);
  const live = pretendDatabase();
  const abandoned = pretendDatabase();
  succeed(requests[0], abandoned);
  expect(abandoned.close).toHaveBeenCalledTimes(1);
  succeed(requests[1], live);
  await retry;
  live.onversionchange();
  expect(live.close).toHaveBeenCalledTimes(1);

  const next = putChunk(chunk);
  succeed(requests[2], pretendDatabase());
  await next;
  expect(open).toHaveBeenCalledTimes(3);
});
