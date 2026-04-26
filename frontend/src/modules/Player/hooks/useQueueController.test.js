import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueueController } from './useQueueController.js';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ items: [], audio: null }),
}));

describe('useQueueController on-deck slot', () => {
  it('pushOnDeck sets the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    expect(result.current.onDeck).toBeNull();
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'Pigs', thumbnail: '/t.jpg' }));
    expect(result.current.onDeck?.id).toBe('plex:1');
  });

  it('pushOnDeck replaces an existing on-deck item (newest wins)', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.pushOnDeck({ id: 'plex:2', title: 'B' }));
    expect(result.current.onDeck?.id).toBe('plex:2');
  });

  it('pushOnDeck with displaceToQueue=true prepends displaced item to queue head', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.pushOnDeck({ id: 'plex:2', title: 'B' }, { displaceToQueue: true }));
    expect(result.current.onDeck?.id).toBe('plex:2');
    expect(result.current.playQueue[0]?.id).toBe('plex:1');
  });

  it('clearOnDeck empties the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.clearOnDeck());
    expect(result.current.onDeck).toBeNull();
  });

  it('flashOnDeck increments the flash key without changing the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    const k0 = result.current.onDeckFlashKey;
    act(() => result.current.flashOnDeck());
    expect(result.current.onDeckFlashKey).toBe(k0 + 1);
    expect(result.current.onDeck?.id).toBe('plex:1');
  });

  it('playNow replaces playQueue head and preserves the tail', async () => {
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    expect(result.current.playQueue[0]?.id).toBe('a');
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.playQueue[1]?.id).toBe('b');
  });

  it('playNow preserves on-deck slot (does not consume it)', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'od', contentId: 'od', title: 'OD' }));
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.onDeck?.id).toBe('od');
  });

  it('playNow on empty queue seeds it with the new head', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    expect(result.current.playQueue.length).toBe(0);
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
  });
});

describe('useQueueController.advance with on-deck', () => {
  it('advance() consumes on-deck before regular queue advance', async () => {
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    act(() => result.current.pushOnDeck({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.onDeck?.id).toBe('x');
    act(() => result.current.advance());
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.onDeck).toBeNull();
  });

  it('advance() falls through to normal queue advance when on-deck is empty', async () => {
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    expect(result.current.onDeck).toBeNull();
    act(() => result.current.advance());
    expect(result.current.playQueue[0]?.id).toBe('b');
  });
});
