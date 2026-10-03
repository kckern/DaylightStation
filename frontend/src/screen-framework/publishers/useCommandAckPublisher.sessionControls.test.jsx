import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));

import { wsService } from '../../services/WebSocketService.js';
import { useCommandAckPublisher } from './useCommandAckPublisher.js';
import { validateCommandAck } from '@shared-contracts/media/envelopes.mjs';

function makeBus() {
  const handlers = new Map();
  return {
    subscribe(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, payload) { for (const h of handlers.get(event) ?? []) h(payload); },
  };
}
const acks = () => wsService.send.mock.calls.map(([m]) => m).filter((m) => m?.topic === 'device-ack');

describe('useCommandAckPublisher — session controls', () => {
  let bus;
  beforeEach(() => { wsService.send.mockClear(); bus = makeBus(); });

  it('acks an Add-only play-now only once applied, saying it was applied as an add', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    act(() => bus.emit('media:queue-op', { op: 'add', contentId: 'plex:9', commandId: 'c1', appliedAs: 'add', requestedOp: 'play-now' }));
    expect(acks()).toHaveLength(0);
    act(() => bus.emit('media:queue-op-applied', { op: 'add', commandId: 'c1', appliedAs: 'add', requestedOp: 'play-now' }));
    expect(acks()).toHaveLength(1);
    expect(acks()[0]).toMatchObject({ ok: true, commandId: 'c1', appliedAs: 'add', requestedOp: 'play-now' });
    expect(validateCommandAck(acks()[0]).valid).toBe(true);
  });

  it('acks a converted item action with appliedAs add', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    act(() => bus.emit('media:queue-op-applied', { op: 'item-action', kind: 'add', commandId: 'c2', appliedAs: 'add' }));
    expect(acks()[0]).toMatchObject({ ok: true, commandId: 'c2', appliedAs: 'add' });
  });

  it('acks session commands only when the controls host reports the outcome', () => {
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    act(() => bus.emit('media:session-control', { kind: 'session', action: 'put-back', commandId: 's1' }));
    expect(acks()).toHaveLength(0);
    act(() => bus.emit('media:session-control-applied', { commandId: 's1' }));
    expect(acks()[0]).toMatchObject({ ok: true, commandId: 's1' });
  });
});
