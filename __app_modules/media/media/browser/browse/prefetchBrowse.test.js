import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock("../logging/mediaLog.js", () => ({ default: { browsePrefetched: vi.fn() } }));

import { prefetchBrowse, resetBrowsePrefetch } from "./prefetchBrowse.js";
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({ items: [], total: 0 });
  resetApiResourceCache();
  resetBrowsePrefetch();
});

describe('prefetchBrowse', () => {
  it('reads the page a browse view will ask for, and its info (GET only)', async () => {
    expect(prefetchBrowse('plex:457029', { now: 1000 })).toBe(true);
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    const urls = apiMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain('api/v1/list/plex/457029/expand?take=50');
    expect(urls).toContain('api/v1/info/plex/457029');
    for (const call of apiMock.mock.calls) expect(call[2] ?? 'GET').toBe('GET');
  });
  it('does not warm the same page twice within 30 s, nor a source root', () => {
    expect(prefetchBrowse('plex:1', { now: 1000 })).toBe(true);
    expect(prefetchBrowse('plex:1', { now: 20_000 })).toBe(false);
    expect(prefetchBrowse('plex:1', { now: 32_000 })).toBe(true);
    expect(prefetchBrowse('plex:', { now: 1000 })).toBe(false);
    expect(prefetchBrowse(null)).toBe(false);
  });
});
