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

  // Helper: filter wsService.send calls down to device-ack envelopes
  // (the beacon publisher also calls wsService.send on a separate topic).
  const ackCalls = () =>
    wsService.send.mock.calls.filter(([m]) => m?.topic === 'device-ack');

  it('sends an ok=true ack when a commanded event is emitted on the bus', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));

    expect(ackCalls().length).toBe(1);
    const ack = ackCalls()[0][0];
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

    expect(ackCalls().length).toBe(1);
  });

  it('re-acks the same commandId after >60s (TTL expiry)', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    expect(ackCalls().length).toBe(1);

    act(() => { vi.advanceTimersByTime(61_000); });

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    expect(ackCalls().length).toBe(2);
  });

  it('emits separate acks for distinct commandIds', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('media:playback', { command: 'play', commandId: 'c1' }));
    act(() => bus.emit('media:queue-op', { op: 'clear', commandId: 'c2' }));

    expect(ackCalls().length).toBe(2);
    const ids = ackCalls().map(([ack]) => ack.commandId).sort();
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('emits ok=false with error when command-handler-error is emitted', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));

    act(() => bus.emit('command-handler-error', { commandId: 'c2', error: 'oops', code: 'E_BAD' }));

    expect(ackCalls().length).toBe(1);
    const ack = ackCalls()[0][0];
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
    expect(ackCalls().length).toBe(0);
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
    expect(ackCalls().length).toBe(0);
  });

  it('sends an online presence beacon on mount', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    const beacon = wsService.send.mock.calls.find(
      ([m]) => m?.topic === 'command-handler-presence:tv-1',
    );
    expect(beacon).toBeDefined();
    expect(beacon[0].deviceId).toBe('tv-1');
    expect(beacon[0].online).toBe(true);
    expect(typeof beacon[0].ts).toBe('string');
  });

  it('repeats the beacon every 10 s', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    wsService.send.mockClear();
    vi.advanceTimersByTime(10_000);
    const calls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'command-handler-presence:tv-1',
    );
    expect(calls.length).toBe(1);
    expect(calls[0][0].online).toBe(true);

    vi.advanceTimersByTime(10_000);
    const calls2 = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'command-handler-presence:tv-1',
    );
    expect(calls2.length).toBe(2);
  });

  it('sends an offline beacon on unmount', () => {
    const { unmount } = renderHook(() =>
      useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }),
    );
    wsService.send.mockClear();
    unmount();
    const offlineBeacon = wsService.send.mock.calls.find(
      ([m]) => m?.topic === 'command-handler-presence:tv-1' && m?.online === false,
    );
    expect(offlineBeacon).toBeDefined();
    expect(offlineBeacon[0].deviceId).toBe('tv-1');
  });

  it('does not send any beacon when deviceId is missing', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: null, actionBus: bus }));
    const beacons = wsService.send.mock.calls.filter(
      ([m]) => typeof m?.topic === 'string' && m.topic.startsWith('command-handler-presence:'),
    );
    expect(beacons.length).toBe(0);
  });

  it('does not double-fire a beacon between the mount call and the first interval tick', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    // The mount beacon counts as call 1. No interval tick has elapsed.
    const beacons = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'command-handler-presence:tv-1',
    );
    expect(beacons.length).toBe(1);
  });
});
