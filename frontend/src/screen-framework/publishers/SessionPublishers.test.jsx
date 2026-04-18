import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: {
    send: vi.fn(),
  },
}));

import { wsService } from '../../services/WebSocketService.js';
import { SessionPublishers } from './SessionPublishers.jsx';
import { SessionSourceProvider } from './SessionSourceContext.jsx';

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
  };
}

function stubSource(snapshot) {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  };
}

describe('SessionPublishers (ScreenRenderer wiring)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsService.send.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes an initial device-state broadcast when deviceId is present', () => {
    const bus = makeBus();
    render(<SessionPublishers deviceId="tv-1" actionBus={bus} />);

    // At least one device-state:initial publish (from the fallback idle source).
    const initialCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state' && m.reason === 'initial',
    );
    expect(initialCalls.length).toBeGreaterThanOrEqual(1);
    const [msg] = initialCalls[0];
    expect(msg.deviceId).toBe('tv-1');
    expect(msg.snapshot.state).toBe('idle');
    expect(msg.snapshot.meta.ownerId).toBe('tv-1');
  });

  it('does nothing when deviceId is falsy', () => {
    const bus = makeBus();
    render(<SessionPublishers deviceId={null} actionBus={bus} />);
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('also mounts the ack publisher (emits ack for commanded event)', () => {
    const bus = makeBus();
    render(<SessionPublishers deviceId="tv-1" actionBus={bus} />);
    wsService.send.mockClear();

    bus.emit('media:playback', { command: 'play', commandId: 'cmd-a' });

    const ackCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-ack' && m.commandId === 'cmd-a',
    );
    expect(ackCalls).toHaveLength(1);
    expect(ackCalls[0][0].ok).toBe(true);
  });

  it('prefers an explicit source prop over the context', () => {
    const bus = makeBus();
    const ctxSnap = createIdleSessionSnapshot({ sessionId: 's-ctx', ownerId: 'tv-1' });
    const explicitSnap = createIdleSessionSnapshot({ sessionId: 's-explicit', ownerId: 'tv-1' });

    render(
      <SessionSourceProvider source={stubSource(ctxSnap)}>
        <SessionPublishers deviceId="tv-1" actionBus={bus} source={stubSource(explicitSnap)} />
      </SessionSourceProvider>,
    );

    const initialCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state' && m.reason === 'initial',
    );
    expect(initialCalls).toHaveLength(1);
    expect(initialCalls[0][0].snapshot.sessionId).toBe('s-explicit');
  });

  it('uses a context-provided source when no explicit source is given', () => {
    const bus = makeBus();
    const ctxSnap = createIdleSessionSnapshot({ sessionId: 's-ctx', ownerId: 'tv-1' });

    render(
      <SessionSourceProvider source={stubSource(ctxSnap)}>
        <SessionPublishers deviceId="tv-1" actionBus={bus} />
      </SessionSourceProvider>,
    );

    const initialCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state' && m.reason === 'initial',
    );
    expect(initialCalls).toHaveLength(1);
    expect(initialCalls[0][0].snapshot.sessionId).toBe('s-ctx');
  });
});
