import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock("../../../../../frontend/src/lib/logging/singleton.js", () => ({ getChildLogger: () => mockLogger }));
import { useFilterData } from './useFilterData.js';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('useFilterData', () => {
  it('ready with data on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ edl: { cues: [] } }) })));
    const { result } = renderHook(() => useFilterData('plex:1', { retryDelayMs: 0 }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data.edl).toBeTruthy();
  });
  it('none on 404, without retrying', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useFilterData('plex:1', { retryDelayMs: 0 }));
    await waitFor(() => expect(result.current.status).toBe('none'));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('retries once on a network error, then reports failed and warns', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useFilterData('plex:1', { retryDelayMs: 0 }));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(f).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn).toHaveBeenCalledWith('content-filter.load.failed', expect.objectContaining({ ratingKey: '1' }));
  });
  it('a 5xx counts as a failure and is retried', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 503 }));
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useFilterData('plex:1', { retryDelayMs: 0 }));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('a retry that succeeds reports ready', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ edl: { cues: [] } }) });
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useFilterData('plex:1', { retryDelayMs: 0 }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('idle when disabled', () => {
    const { result } = renderHook(() => useFilterData('plex:1', { enabled: false }));
    expect(result.current).toEqual({ data: null, status: 'idle', reload: expect.any(Function) });
  });
  it("drops the previous title's data as soon as the content id changes", async () => {
    const edlA = { edl: { cues: [{ id: 'a' }] } };
    let resolveB;
    const f = vi.fn((url) => (url.includes('/1?')
      ? Promise.resolve({ ok: true, status: 200, json: async () => edlA })
      : new Promise((r) => { resolveB = r; })));
    vi.stubGlobal('fetch', f);
    const { result, rerender } = renderHook(({ id }) => useFilterData(id, { retryDelayMs: 0 }), { initialProps: { id: 'plex:1' } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toBe(edlA);
    rerender({ id: 'plex:2' });
    expect(result.current).toEqual({ data: null, status: 'loading', reload: expect.any(Function) });
    const edlB = { edl: { cues: [{ id: 'b' }] } };
    resolveB({ ok: true, status: 200, json: async () => edlB });
    await waitFor(() => expect(result.current.data).toBe(edlB));
  });
});

describe('useFilterData — reload', () => {
  it('refetches without clearing the current data, and resolves when done', async () => {
    let n = 0;
    const f = vi.fn(async () => { n += 1; return { ok: true, status: 200, json: async () => ({ edl: { cues: [], n } }) }; });
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useFilterData('plex:1', { retryDelayMs: 0 }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const seen = [];
    const p = result.current.reload();
    seen.push(result.current.data);
    await p;
    await waitFor(() => expect(result.current.data.edl.n).toBe(2));
    expect(seen[0].edl.n).toBe(1);
    expect(result.current.status).toBe('ready');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a failed reload keeps the current data and resolves', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      if (n > 1) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ edl: { cues: [] } }) };
    }));
    const { result } = renderHook(() => useFilterData('plex:1', { retryDelayMs: 0 }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = result.current.data;
    await expect(result.current.reload()).resolves.toBeUndefined();
    expect(result.current.data).toBe(before);
    expect(result.current.status).toBe('ready');
    expect(mockLogger.warn).toHaveBeenCalledWith('content-filter.reload.failed', expect.objectContaining({ ratingKey: '1' }));
  });
});
