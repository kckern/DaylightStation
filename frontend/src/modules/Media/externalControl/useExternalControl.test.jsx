import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeFn = vi.fn();
const sendFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: (...a) => sendFn(...a), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
  default: { send: (...a) => sendFn(...a), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
}));

vi.mock('../identity/ClientIdentityProvider.jsx', () => ({
  useClientIdentity: vi.fn(() => ({ clientId: 'c1', displayName: 'D' })),
}));

import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { useExternalControl } from './useExternalControl.js';

function makeController() {
  return {
    transport: { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
    queue: { playNow: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn(), remove: vi.fn(), reorder: vi.fn(), jump: vi.fn(), clear: vi.fn() },
    config: { setShuffle: vi.fn(), setRepeat: vi.fn(), setShader: vi.fn(), setVolume: vi.fn() },
    lifecycle: { reset: vi.fn(), adoptSnapshot: vi.fn() },
  };
}

let capturedFilter = null;
let capturedCallback = null;
let controller;
beforeEach(() => {
  controller = makeController();
  subscribeFn.mockReset().mockImplementation((filter, cb) => {
    capturedFilter = filter;
    capturedCallback = cb;
    return () => {};
  });
  sendFn.mockReset();
});

describe('useExternalControl', () => {
  it('subscribes with a filter matching only client-control:<clientId>', () => {
    renderHook(() => useExternalControl(controller));
    expect(typeof capturedFilter).toBe('function');
    expect(capturedFilter({ topic: 'client-control:c1' })).toBe(true);
    expect(capturedFilter({ topic: 'client-control:other' })).toBe(false);
  });

  it('routes transport commands and acks ok', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:c1', commandId: 'cmd1', command: 'transport', params: { action: 'pause' } });
    });
    expect(controller.transport.pause).toHaveBeenCalled();
    expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'client-ack', clientId: 'c1', commandId: 'cmd1', ok: true,
    }));
  });

  it('routes queue play-now commands', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:c1', commandId: 'cmd2', command: 'queue', params: { op: 'play-now', contentId: 'plex:1', clearRest: true } });
    });
    expect(controller.queue.playNow).toHaveBeenCalledWith({ contentId: 'plex:1' }, { clearRest: true });
  });

  it('routes adopt-snapshot commands', () => {
    renderHook(() => useExternalControl(controller));
    const snap = createIdleSessionSnapshot({ sessionId: 'x', ownerId: 'c9' });
    act(() => {
      capturedCallback({ topic: 'client-control:c1', commandId: 'cmd4', command: 'adopt-snapshot', params: { snapshot: snap, autoplay: false } });
    });
    expect(controller.lifecycle.adoptSnapshot).toHaveBeenCalledWith(snap, { autoplay: false });
  });

  it('acks not-ok with a reason for invalid envelopes', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:c1', commandId: 'cmd5', command: 'transport', params: { action: 'explode' } });
    });
    expect(controller.transport.play).not.toHaveBeenCalled();
    expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'client-ack', commandId: 'cmd5', ok: false,
    }));
  });

  it('ignores messages without a commandId', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:c1', command: 'transport', params: { action: 'play' } });
    });
    expect(sendFn).not.toHaveBeenCalled();
  });
});
