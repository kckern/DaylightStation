import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInitialActionGate } from './useInitialActionGate.js';

describe('useInitialActionGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns suppressLayout=false when search has no action params', () => {
    const { result } = renderHook(() =>
      useInitialActionGate('?foo=bar&baz=qux'),
    );
    expect(result.current.suppressLayout).toBe(false);
  });

  it('returns suppressLayout=true when search has play=', () => {
    const { result } = renderHook(() =>
      useInitialActionGate('?play=plex:620707'),
    );
    expect(result.current.suppressLayout).toBe(true);
  });

  it('returns suppressLayout=true for queue= and open= too', () => {
    expect(
      renderHook(() => useInitialActionGate('?queue=plex:1')).result.current
        .suppressLayout,
    ).toBe(true);
    expect(
      renderHook(() => useInitialActionGate('?open=videocall/x')).result.current
        .suppressLayout,
    ).toBe(true);
  });

  it('clears suppressLayout when releaseGate is called', () => {
    const { result } = renderHook(() => useInitialActionGate('?play=plex:1'));
    expect(result.current.suppressLayout).toBe(true);
    act(() => result.current.releaseGate());
    expect(result.current.suppressLayout).toBe(false);
  });

  it('auto-clears after the safety timeout (5s)', () => {
    const { result } = renderHook(() => useInitialActionGate('?play=plex:1'));
    expect(result.current.suppressLayout).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.suppressLayout).toBe(false);
  });

  it('does not re-engage when search changes mid-session (initial only)', () => {
    const { result, rerender } = renderHook(
      ({ s }) => useInitialActionGate(s),
      { initialProps: { s: '' } },
    );
    expect(result.current.suppressLayout).toBe(false);
    rerender({ s: '?play=plex:1' });
    expect(result.current.suppressLayout).toBe(false); // initial-only
  });
});
