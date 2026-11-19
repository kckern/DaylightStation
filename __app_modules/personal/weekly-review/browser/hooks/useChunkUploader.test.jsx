import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { markChunkUploaded } from './chunkDb.js';
import { useChunkUploader } from './useChunkUploader.js';

vi.mock('./chunkDb.js', () => ({
  putChunk: vi.fn(async () => {}),
  markChunkUploaded: vi.fn(async () => {}),
  getChunksForSession: vi.fn(async () => []),
  purgeExpired: vi.fn(async () => 0),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('retains a refused chunk and acknowledges it only after a successful retry', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useChunkUploader({ sessionId: 'fixture', week: '2026-W44' }));
  const blob = { arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  await act(async () => { await result.current.enqueue({ seq: 0, blob }); });
  await waitFor(() => expect(result.current.status).toBe('offline'));
  expect(markChunkUploaded).not.toHaveBeenCalled();
  expect(result.current.pendingCount).toBe(1);
  act(() => { result.current.flushNow(); });
  await waitFor(() => expect(result.current.pendingCount).toBe(0));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(markChunkUploaded.mock.calls).toEqual([[{ sessionId: 'fixture', seq: 0 }]]);
  for (const [url, options] of fetch.mock.calls) {
    expect(url).toBe(location.origin + '/api/v1/weekly-review/recording/chunk');
    expect(options.method).toBe('POST');
    expect(options.headers['X-Daylight-Device']).toBeTruthy();
    expect(JSON.parse(options.body)).toEqual({ sessionId: 'fixture', seq: 0, week: '2026-W44', chunkBase64: 'AQID' });
  }
});
