import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../../../frontend/src/lib/logging/singleton.js', () => {
  const stub = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  return { getChildLogger: () => stub };
});
vi.mock('./logoContrast.js', () => ({ imageNeedsPlate: () => false }));

const { useProvenance, PROVENANCE_FETCH_TIMEOUT_MS } = await import('./useProvenance.js');

const BODY = { provenance: { provider: 'hoopla', tier: 'free', logo: '/logo/hoopla' } };

/** A fetch that answers per rating key; `hang` keys never answer (until aborted). */
function stubFetch({ hang = [] } = {}) {
  return vi.fn((url, { signal } = {}) => {
    const rk = url.split('/').pop();
    if (hang.includes(rk)) {
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(BODY) });
  });
}

describe('useProvenance', () => {
  let realImage;
  beforeEach(() => {
    realImage = globalThis.Image;
    globalThis.Image = class { set src(_) { queueMicrotask(() => this.onload?.()); } };
  });
  afterEach(() => {
    globalThis.Image = realImage;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('never returns the previous title\'s answer on the first render for a new title', async () => {
    vi.stubGlobal('fetch', stubFetch({ hang: ['2'] }));
    const seen = [];
    const { result, rerender } = renderHook(({ id }) => {
      const s = useProvenance(id);
      seen.push([id, s.status, s.data?.provider ?? null]);
      return s;
    }, { initialProps: { id: 'plex:1' } });
    await vi.waitFor(() => expect(result.current.status).toBe('ready'));
    seen.length = 0;
    rerender({ id: 'plex:2' });
    expect(seen[0]).toEqual(['plex:2', 'loading', null]);
    expect(seen.some(([id, , provider]) => id === 'plex:2' && provider)).toBe(false);
  });

  it('gives up a lookup that does not answer in time', async () => {
    expect(PROVENANCE_FETCH_TIMEOUT_MS).toBe(8000);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stubFetch({ hang: ['7'] }));
    const { result } = renderHook(() => useProvenance('plex:7'));
    expect(result.current.status).toBe('loading');
    await act(async () => { vi.advanceTimersByTime(PROVENANCE_FETCH_TIMEOUT_MS); });
    expect(result.current.status).toBe('failed');
  });
});
