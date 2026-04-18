import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: {
    send: vi.fn(),
  },
}));

import { wsService } from '../../services/WebSocketService.js';
import { useCommandAckPublisher } from './useCommandAckPublisher.js';

/** Minimal ActionBus stub with `.subscribe(event, handler)` + `.emit(event, payload)`. */
function makeBus() {
  const handlers = new Map();
  return {
    subscribe(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of set) h(payload);
    },
    size(event) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}

describe('useCommandAckPublisher', () => {
  let bus;

  beforeEach(() => {
    vi.useFakeTimers();
    wsService.send.mockClear();
    bus = makeBus();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an ok=true ack when a commanded event is emitted on the bus', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));

    expect(wsService.send).toHaveBeenCalledTimes(1);
    const ack = wsService.send.mock.calls[0][0];
    expect(ack.topic).toBe('device-ack');
    expect(ack.deviceId).toBe('tv-1');
    expect(ack.commandId).toBe('c1');
    expect(ack.ok).toBe(true);
    expect(typeof ack.appliedAt).toBe('string');
  });

  it('dedupes a repeated commandId within the 60s window', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    act(() => bus.emit('media:seek-abs', { value: 10, commandId: 'c1' }));

    expect(wsService.send).toHaveBeenCalledTimes(1);
  });

  it('re-acks the same commandId after >60s (TTL expiry)', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    expect(wsService.send).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(61_000); });

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    expect(wsService.send).toHaveBeenCalledTimes(2);
  });

  it('emits separate acks for distinct commandIds', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    act(() => bus.emit('media:queue-op', { op: 'clear', commandId: 'c2' }));

    expect(wsService.send).toHaveBeenCalledTimes(2);
    const ids = wsService.send.mock.calls.map(([ack]) => ack.commandId).sort();
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('emits ok=false with error when command-handler-error is emitted', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('command-handler-error', { commandId: 'c2', error: 'oops', code: 'E_BAD' }));

    expect(wsService.send).toHaveBeenCalledTimes(1);
    const ack = wsService.send.mock.calls[0][0];
    expect(ack.ok).toBe(false);
    expect(ack.commandId).toBe('c2');
    expect(ack.error).toBe('oops');
    expect(ack.code).toBe('E_BAD');
  });

  it('is a no-op when deviceId is falsy', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: null, actionBus: bus }));
    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    expect(wsService.send).not.toHaveBeenCalled();
    // The subscribe call should also have been skipped.
    expect(bus.size('media:playback')).toBe(0);
  });

  it('ignores bus emits missing a commandId', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    act(() => bus.emit('media:playback', { command: 'play' }));  // no commandId
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('detaches ActionBus listeners on unmount', () => {
    const { unmount } = renderHook(() => useCommandAckPublisher({
      deviceId: 'tv-1',
      actionBus: bus,
    }));

    // Sanity: subscription is live pre-unmount.
    expect(bus.size('media:playback')).toBeGreaterThan(0);
    unmount();
    expect(bus.size('media:playback')).toBe(0);
    expect(bus.size('command-handler-error')).toBe(0);

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c-late' }));
    expect(wsService.send).not.toHaveBeenCalled();
  });
});
