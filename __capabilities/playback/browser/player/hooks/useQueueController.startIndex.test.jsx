// A book's queue comes back in its own order with startIndex (the part in
// progress). The screen plays from there; Previous still reaches earlier parts.
// A show or music answer has no startIndex and starts at its first item.
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { useQueueController } from './useQueueController.js';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const parts = [1, 2, 3, 4, 5].map((n) => ({ id: `plex:${n}`, contentId: `plex:${n}`, mediaType: 'audio', mediaUrl: `/s/${n}` }));

describe('useQueueController start of an ordered work', () => {
  it('starts at startIndex and keeps the earlier parts for Previous', async () => {
    DaylightAPI.mockResolvedValueOnce({ items: parts, startIndex: 2 });
    const { result } = renderHook(() => useQueueController({ play: { contentId: 'plex:727787' } }));
    await waitFor(() => expect(result.current.playQueue).toHaveLength(3));
    expect(result.current.playQueue.map((item) => item.contentId)).toEqual(['plex:3', 'plex:4', 'plex:5']);
    expect(result.current.queueSnapshot.items.map((item) => item.contentId)).toEqual(['plex:1', 'plex:2', 'plex:3', 'plex:4', 'plex:5']);
    expect(result.current.queueSnapshot.currentIndex).toBe(2);
    act(() => result.current.advance(-1));
    expect(result.current.playQueue[0].contentId).toBe('plex:2');
  });

  it('an answer without startIndex starts at its first item, as before', async () => {
    DaylightAPI.mockResolvedValueOnce({ items: parts });
    const { result } = renderHook(() => useQueueController({ play: { contentId: 'plex:100' } }));
    await waitFor(() => expect(result.current.playQueue).toHaveLength(5));
    expect(result.current.playQueue[0].contentId).toBe('plex:1');
  });

  it('replaceQueue honours startIndex (a play-now of a book on a running screen)', async () => {
    DaylightAPI.mockResolvedValueOnce({ items: [parts[0]] });
    const { result } = renderHook(() => useQueueController({ play: { contentId: 'plex:9' } }));
    await waitFor(() => expect(result.current.playQueue).toHaveLength(1));
    act(() => result.current.replaceQueue(parts, { startIndex: 3 }));
    expect(result.current.playQueue.map((item) => item.contentId)).toEqual(['plex:4', 'plex:5']);
    act(() => result.current.replaceQueue(parts));
    expect(result.current.playQueue).toHaveLength(5);
  });
});
