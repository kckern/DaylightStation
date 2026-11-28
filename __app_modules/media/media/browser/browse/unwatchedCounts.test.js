import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));
vi.mock("../logging/mediaLog.js", () => ({ default: { unwatchedCountsFailed: vi.fn() } }));

import { watchUnwatched, countsUnwatched, unwatchedLine, resetUnwatchedCounts } from "./unwatchedCounts.js";

beforeEach(() => { apiMock.mockReset(); resetUnwatchedCounts(); });

describe('unwatched counts', () => {
  it('asks for every id wanted in the same moment in one request, and remembers the answers', async () => {
    apiMock.mockResolvedValue({ counts: { 'plex:1': { unwatched: 3, total: 18 }, 'plex:2': { unwatched: 0, total: 4 } } });
    const heard = [];
    watchUnwatched('plex:1', (v) => heard.push(['1', v]));
    watchUnwatched('plex:2', (v) => heard.push(['2', v]));
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][0]).toBe('api/v1/content/query/unwatched?ids=plex%3A1,plex%3A2');
    watchUnwatched('plex:1', (v) => heard.push(['1 again', v]));
    expect(heard.at(-1)).toEqual(['1 again', { unwatched: 3, total: 18 }]);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
  it('counts only shows and seasons, and words the line', () => {
    expect(countsUnwatched({ id: 'plex:1', type: 'show' })).toBe(true);
    expect(countsUnwatched({ id: 'plex:1', metadata: { type: 'season' } })).toBe(true);
    expect(countsUnwatched({ id: 'plex:1', type: 'movie' })).toBe(false);
    expect(unwatchedLine({ unwatched: 3, total: 18 })).toBe('3 unwatched');
    expect(unwatchedLine({ unwatched: 0, total: 18 })).toBe('All watched');
    expect(unwatchedLine(null)).toBeNull();
  });
});
