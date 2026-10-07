import { describe, it, expect, vi } from 'vitest';
import { liveEdgeSeconds, seekToLiveEdge } from './liveEdge.js';

const ranges = (...pairs) => ({ length: pairs.length, start: (i) => pairs[i][0], end: (i) => pairs[i][1] });

describe('liveEdge', () => {
  it('uses the end of the last seekable range', () => {
    expect(liveEdgeSeconds({ seekable: ranges([0, 10], [20, 95.5]), duration: Infinity })).toBe(95.5);
  });
  it('reads a live progressive stream (empty seekable, growing duration and buffer)', () => {
    expect(liveEdgeSeconds({ seekable: ranges([0, 0]), buffered: ranges([0, 11.006]), duration: 11.023 })).toBe(11.023);
  });
  it('falls back to a finite duration, and to null with no edge at all', () => {
    expect(liveEdgeSeconds({ seekable: ranges(), duration: 30 })).toBe(30);
    expect(liveEdgeSeconds({ seekable: ranges(), duration: Infinity })).toBeNull();
    expect(liveEdgeSeconds(null)).toBeNull();
  });
  it('seeks to the edge and resumes playback', () => {
    const el = { seekable: ranges([0, 50]), duration: Infinity, currentTime: 10, play: vi.fn(() => Promise.resolve()) };
    expect(seekToLiveEdge(el)).toEqual({ ok: true, edge: 50 });
    expect(el.currentTime).toBe(50);
    expect(el.play).toHaveBeenCalled();
  });
  it('reports NO_LIVE_EDGE without touching the element', () => {
    const el = { seekable: ranges(), duration: NaN, currentTime: 3, play: vi.fn() };
    expect(seekToLiveEdge(el)).toEqual({ ok: false, code: 'NO_LIVE_EDGE' });
    expect(el.currentTime).toBe(3);
    expect(el.play).not.toHaveBeenCalled();
  });
});
