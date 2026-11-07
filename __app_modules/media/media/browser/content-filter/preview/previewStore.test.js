import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { previewStore, useFilterPreview } from './previewStore.js';

beforeEach(() => previewStore.reset());

describe('previewStore', () => {
  it('starts with an empty, closed snapshot and working no-op actions (no subscribers, no surround)', async () => {
    const s = previewStore.getSnapshot();
    expect(s).toMatchObject({ ratingKey: null, title: null, cues: [], scenes: [], lastFired: null, filterActive: false, open: false });
    expect(() => previewStore.seekTo(10)).not.toThrow();
    expect(() => previewStore.jumpToCue({ in: 10 })).not.toThrow();
    expect(() => previewStore.replayLast()).not.toThrow();
    expect(() => previewStore.peek('x')).not.toThrow();
    expect(() => previewStore.close()).not.toThrow();
    await expect(previewStore.refresh()).resolves.toBeUndefined();
  });

  it('publish notifies subscribers once per call', () => {
    const fn = vi.fn();
    const unsub = previewStore.subscribe(fn);
    previewStore.publish({ title: 'A' });
    expect(fn).toHaveBeenCalledTimes(1);
    previewStore.publish({ filterActive: true, ratingKey: '1' });
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
    previewStore.publish({ title: 'B' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('getSnapshot is referentially stable between publishes and new after one', () => {
    const a = previewStore.getSnapshot();
    expect(previewStore.getSnapshot()).toBe(a);
    previewStore.publish({ title: 'A' });
    const b = previewStore.getSnapshot();
    expect(b).not.toBe(a);
    expect(b.title).toBe('A');
    expect(previewStore.getSnapshot()).toBe(b);
  });

  it('jumpToCue({ in: 100 }) seeks to 96 and plays, through the bound transport', () => {
    const seek = vi.fn();
    const play = vi.fn();
    previewStore.bind({ seek, play });
    previewStore.jumpToCue({ in: 100 });
    expect(seek).toHaveBeenCalledWith(96);
    expect(play).toHaveBeenCalledTimes(1);
    previewStore.jumpToCue({ in: 2 });
    expect(seek).toHaveBeenLastCalledWith(0); // never before the start
  });

  it('replayLast jumps to 4 s before the last fired cue', () => {
    const seek = vi.fn();
    previewStore.bind({ seek, play: vi.fn() });
    previewStore.publish({ lastFired: { id: 'm', in: 50, out: 51 } });
    previewStore.replayLast();
    expect(seek).toHaveBeenCalledWith(46);
  });

  it('delegates peek, refresh and close to the bound handlers; unbind restores no-ops', async () => {
    const peek = vi.fn();
    const refresh = vi.fn(async () => {});
    const close = vi.fn();
    const unbind = previewStore.bind({ peek, refresh, close });
    previewStore.peek('va1');
    await previewStore.refresh();
    previewStore.close();
    expect(peek).toHaveBeenCalledWith('va1');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    unbind();
    previewStore.peek('va1');
    expect(peek).toHaveBeenCalledTimes(1);
  });

  it('useFilterPreview re-renders with the published snapshot', () => {
    const { result } = renderHook(() => useFilterPreview());
    expect(result.current.title).toBeNull();
    act(() => previewStore.publish({ title: 'Film' }));
    expect(result.current.title).toBe('Film');
  });
});
