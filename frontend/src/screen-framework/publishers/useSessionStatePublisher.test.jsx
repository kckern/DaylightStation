import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: {
    send: vi.fn(),
  },
}));

// Import AFTER mock so the mock is in effect.
import { wsService } from '../../services/WebSocketService.js';
import { useSessionStatePublisher } from './useSessionStatePublisher.js';

function makeSnapshot(overrides = {}) {
  const base = createIdleSessionSnapshot({ sessionId: 's-1', ownerId: 'tv-1' });
  return { ...base, ...overrides };
}

function makeSource(initialSnapshot) {
  let current = initialSnapshot ?? makeSnapshot();
  const handlers = { onChange: null, onStateTransition: null };
  return {
    getSnapshot: vi.fn(() => current),
    setSnapshot: (next) => { current = next; },
    subscribe: vi.fn(({ onChange, onStateTransition }) => {
      handlers.onChange = onChange;
      handlers.onStateTransition = onStateTransition;
      return () => {
        handlers.onChange = null;
        handlers.onStateTransition = null;
      };
    }),
    fireChange: () => handlers.onChange?.(),
    fireState: (state) => handlers.onStateTransition?.(state),
    hasSubscriber: () => handlers.onChange !== null,
  };
}

describe('useSessionStatePublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsService.send.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes an initial device-state broadcast on mount', () => {
    const source = makeSource();
    renderHook(() => useSessionStatePublisher({
      deviceId: 'tv-1',
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));

    expect(wsService.send).toHaveBeenCalledTimes(1);
    const sent = wsService.send.mock.calls[0][0];
    expect(sent.topic).toBe('device-state');
    expect(sent.deviceId).toBe('tv-1');
    expect(sent.reason).toBe('initial');
    expect(sent.snapshot).toBeTruthy();
    expect(typeof sent.ts).toBe('string');
  });

  it('is a no-op when deviceId is null', () => {
    const source = makeSource();
    renderHook(() => useSessionStatePublisher({
      deviceId: null,
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));
    expect(wsService.send).not.toHaveBeenCalled();
    expect(source.subscribe).not.toHaveBeenCalled();
  });

  it('is a no-op when deviceId is undefined', () => {
    const source = makeSource();
    renderHook(() => useSessionStatePublisher({
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('debounces onChange: publishes reason=change after 500ms', () => {
    const source = makeSource();
    renderHook(() => useSessionStatePublisher({
      deviceId: 'tv-1',
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));
    wsService.send.mockClear(); // drop the initial publish

    act(() => source.fireChange());
    expect(wsService.send).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(499); });
    expect(wsService.send).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(wsService.send).toHaveBeenCalledTimes(1);
    expect(wsService.send.mock.calls[0][0].reason).toBe('change');
  });

  it('coalesces multiple rapid onChange calls into a single publish', () => {
    const source = makeSource();
    renderHook(() => useSessionStatePublisher({
      deviceId: 'tv-1',
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));
    wsService.send.mockClear();

    act(() => source.fireChange());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => source.fireChange());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => source.fireChange());

    // Nothing published yet.
    expect(wsService.send).not.toHaveBeenCalled();

    // After the final 500ms window closes, exactly one publish.
    act(() => { vi.advanceTimersByTime(500); });
    expect(wsService.send).toHaveBeenCalledTimes(1);
    expect(wsService.send.mock.calls[0][0].reason).toBe('change');
  });

  it('starts a 5s heartbeat on non-idle transition', () => {
    const source = makeSource(makeSnapshot({ state: 'playing' }));
    renderHook(() => useSessionStatePublisher({
      deviceId: 'tv-1',
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));
    wsService.send.mockClear();

    act(() => source.fireState('playing'));

    act(() => { vi.advanceTimersByTime(4999); });
    expect(wsService.send).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(wsService.send).toHaveBeenCalledTimes(1);
    expect(wsService.send.mock.calls[0][0].reason).toBe('heartbeat');

    act(() => { vi.advanceTimersByTime(5000); });
    expect(wsService.send).toHaveBeenCalledTimes(2);
    expect(wsService.send.mock.calls[1][0].reason).toBe('heartbeat');
  });

  it('stops heartbeat on idle transition', () => {
    const source = makeSource(makeSnapshot({ state: 'playing' }));
    renderHook(() => useSessionStatePublisher({
      deviceId: 'tv-1',
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));
    wsService.send.mockClear();

    act(() => source.fireState('playing'));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(wsService.send).toHaveBeenCalledTimes(1); // one heartbeat

    act(() => source.fireState('idle'));
    wsService.send.mockClear();

    act(() => { vi.advanceTimersByTime(20000); });
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('unmount cancels debounce and heartbeat and unsubscribes', () => {
    const source = makeSource(makeSnapshot({ state: 'playing' }));
    const { unmount } = renderHook(() => useSessionStatePublisher({
      deviceId: 'tv-1',
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));
    wsService.send.mockClear();

    act(() => source.fireState('playing'));  // start heartbeat
    act(() => source.fireChange());           // arm debounce

    unmount();

    // Subscribe handle should be released.
    expect(source.hasSubscriber()).toBe(false);

    // Neither the pending debounce nor the heartbeat should fire.
    act(() => { vi.advanceTimersByTime(10000); });
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('skips initial publish when getSnapshot returns null', () => {
    const source = makeSource();
    source.getSnapshot.mockReturnValue(null);
    renderHook(() => useSessionStatePublisher({
      deviceId: 'tv-1',
      getSnapshot: source.getSnapshot,
      subscribe: source.subscribe,
    }));
    expect(wsService.send).not.toHaveBeenCalled();
  });
});
