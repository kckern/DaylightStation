import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStatusOverlay } from './useStatusOverlay.js';

function mapOf(devices) {
  const m = new Map();
  devices.forEach((d) => m.set(d.color, d));
  return m;
}

describe('useStatusOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('statusView passes through real status when no predictions', () => {
    const real = mapOf([{ color: 'red', paused: false, volume: 50, now_playing: null }]);
    const { result } = renderHook(() => useStatusOverlay(real));
    const view = result.current.statusView.get('red');
    expect(view.paused).toBe(false);
    expect(view.volume).toBe(50);
    expect(view._pending).toBeInstanceOf(Set);
    expect(view._pending.size).toBe(0);
  });

  describe('predict (match-to-clear)', () => {
    it('overlays predicted value and marks field as pending', () => {
      const real = mapOf([{ color: 'red', paused: false }]);
      const { result } = renderHook(() => useStatusOverlay(real));

      act(() => {
        result.current.predict('red', { paused: true });
      });

      const view = result.current.statusView.get('red');
      expect(view.paused).toBe(true);
      expect(view._pending.has('paused')).toBe(true);
    });

    it('clears prediction when real status matches predicted value', () => {
      let real = mapOf([{ color: 'red', paused: false }]);
      const { result, rerender } = renderHook(({ s }) => useStatusOverlay(s), {
        initialProps: { s: real },
      });

      act(() => {
        result.current.predict('red', { paused: true });
      });
      expect(result.current.statusView.get('red')._pending.has('paused')).toBe(true);

      real = mapOf([{ color: 'red', paused: true }]);
      rerender({ s: real });

      const view = result.current.statusView.get('red');
      expect(view.paused).toBe(true);
      expect(view._pending.has('paused')).toBe(false);
    });

    it('keeps prediction when real status does NOT match predicted value', () => {
      let real = mapOf([{ color: 'red', volume: 50 }]);
      const { result, rerender } = renderHook(({ s }) => useStatusOverlay(s), {
        initialProps: { s: real },
      });

      act(() => {
        result.current.predict('red', { volume: 75 });
      });

      // WS reports a different value than predicted.
      real = mapOf([{ color: 'red', volume: 60 }]);
      rerender({ s: real });

      // Prediction holds.
      const view = result.current.statusView.get('red');
      expect(view.volume).toBe(75);
      expect(view._pending.has('volume')).toBe(true);
    });

    it('lifts prediction after default 5s timeout even if real never matches', () => {
      const real = mapOf([{ color: 'red', paused: false }]);
      const { result } = renderHook(() => useStatusOverlay(real));

      act(() => {
        result.current.predict('red', { paused: true });
      });
      expect(result.current.statusView.get('red')._pending.has('paused')).toBe(true);

      act(() => {
        vi.advanceTimersByTime(5100);
      });

      expect(result.current.statusView.get('red')._pending.has('paused')).toBe(false);
      expect(result.current.statusView.get('red').paused).toBe(false);
    });

    it('respects custom timeoutMs', () => {
      const real = mapOf([{ color: 'red', paused: false }]);
      const { result } = renderHook(() => useStatusOverlay(real));

      act(() => {
        result.current.predict('red', { paused: true }, { timeoutMs: 1000 });
      });
      act(() => { vi.advanceTimersByTime(800); });
      expect(result.current.statusView.get('red')._pending.has('paused')).toBe(true);

      act(() => { vi.advanceTimersByTime(300); });
      expect(result.current.statusView.get('red')._pending.has('paused')).toBe(false);
    });

    it('multiple predictions on different fields coexist; resolve independently', () => {
      let real = mapOf([{ color: 'red', paused: false, volume: 50 }]);
      const { result, rerender } = renderHook(({ s }) => useStatusOverlay(s), {
        initialProps: { s: real },
      });

      act(() => {
        result.current.predict('red', { paused: true });
        result.current.predict('red', { volume: 80 });
      });

      const view1 = result.current.statusView.get('red');
      expect(view1.paused).toBe(true);
      expect(view1.volume).toBe(80);
      expect(view1._pending.has('paused')).toBe(true);
      expect(view1._pending.has('volume')).toBe(true);

      // Only paused confirms.
      real = mapOf([{ color: 'red', paused: true, volume: 50 }]);
      rerender({ s: real });

      const view2 = result.current.statusView.get('red');
      expect(view2._pending.has('paused')).toBe(false);
      expect(view2._pending.has('volume')).toBe(true);
      expect(view2.volume).toBe(80); // still overlaid
    });
  });

  describe('pending (lock-until-change)', () => {
    it('marks fields as pending without changing visible value', () => {
      const real = mapOf([{ color: 'red', now_playing: { title: 'track A' } }]);
      const { result } = renderHook(() => useStatusOverlay(real));

      act(() => {
        result.current.pending('red', ['now_playing']);
      });

      const view = result.current.statusView.get('red');
      expect(view.now_playing).toEqual({ title: 'track A' });
      expect(view._pending.has('now_playing')).toBe(true);
    });

    it('clears the lock when real value for any locked field changes', () => {
      let real = mapOf([{ color: 'red', now_playing: { title: 'track A' } }]);
      const { result, rerender } = renderHook(({ s }) => useStatusOverlay(s), {
        initialProps: { s: real },
      });

      act(() => {
        result.current.pending('red', ['now_playing']);
      });
      expect(result.current.statusView.get('red')._pending.has('now_playing')).toBe(true);

      real = mapOf([{ color: 'red', now_playing: { title: 'track B' } }]);
      rerender({ s: real });

      expect(result.current.statusView.get('red')._pending.has('now_playing')).toBe(false);
    });

    it('lifts lock after timeout if real value never changes', () => {
      const real = mapOf([{ color: 'red', now_playing: { title: 'track A' } }]);
      const { result } = renderHook(() => useStatusOverlay(real));

      act(() => {
        result.current.pending('red', ['now_playing'], { timeoutMs: 1500 });
      });
      expect(result.current.statusView.get('red')._pending.has('now_playing')).toBe(true);

      act(() => { vi.advanceTimersByTime(1600); });
      expect(result.current.statusView.get('red')._pending.has('now_playing')).toBe(false);
    });
  });

  describe('multi-device', () => {
    it('predictions are scoped to the device color', () => {
      const real = mapOf([
        { color: 'red', paused: false },
        { color: 'blue', paused: false },
      ]);
      const { result } = renderHook(() => useStatusOverlay(real));

      act(() => {
        result.current.predict('red', { paused: true });
      });

      expect(result.current.statusView.get('red')._pending.has('paused')).toBe(true);
      expect(result.current.statusView.get('blue')._pending.has('paused')).toBe(false);
      expect(result.current.statusView.get('blue').paused).toBe(false);
    });
  });
});
