import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeFn = vi.fn();
const sendFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: (...a) => sendFn(...a), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
  default: { send: (...a) => sendFn(...a), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
}));

vi.mock('../session/ClientIdentityProvider.jsx', () => ({
  useClientIdentity: vi.fn(() => ({ clientId: 'c1', displayName: 'D' })),
}));

const playNowFn = vi.fn();
const pauseFn = vi.fn();
const setVolumeFn = vi.fn();
const adoptFn = vi.fn();
const ctrl = {
  snapshot: {},
  transport: { play: vi.fn(), pause: pauseFn, stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
  queue: { playNow: playNowFn, playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn(), clear: vi.fn(), remove: vi.fn(), jump: vi.fn(), reorder: vi.fn() },
  config: { setShuffle: vi.fn(), setRepeat: vi.fn(), setShader: vi.fn(), setVolume: setVolumeFn },
  lifecycle: { adoptSnapshot: adoptFn, reset: vi.fn() },
  portability: {},
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => ctrl),
}));

import { useExternalControl } from './useExternalControl.js';

let capturedFilter = null;
let capturedCallback = null;
beforeEach(() => {
  subscribeFn.mockReset().mockImplementation((filter, cb) => { capturedFilter = filter; capturedCallback = cb; return () => {}; });
  sendFn.mockReset();
  playNowFn.mockReset();
  pauseFn.mockReset();
  setVolumeFn.mockReset();
  adoptFn.mockReset();
});

describe('useExternalControl', () => {
  it('subscribes using a topic filter for client-control:<clientId>', () => {
    renderHook(() => useExternalControl());
    expect(typeof capturedFilter).toBe('function');
    expect(capturedFilter({ topic: 'client-control:c1' })).toBe(true);
    expect(capturedFilter({ topic: 'client-control:other' })).toBe(false);
  });

  it('routes transport commands to controller', () => {
    renderHook(() => useExternalControl());
    act(() => {
      capturedCallback({
        topic: 'client-control:c1',
        commandId: 'cmd1',
        command: 'transport',
        params: { action: 'pause' },
      });
    });
    expect(pauseFn).toHaveBeenCalled();
  });

  it('routes queue play-now commands', () => {
    renderHook(() => useExternalControl());
    act(() => {
      capturedCallback({
        topic: 'client-control:c1',
        commandId: 'cmd2',
        command: 'queue',
        params: { op: 'play-now', contentId: 'plex:1', clearRest: true },
      });
    });
    expect(playNowFn).toHaveBeenCalledWith({ contentId: 'plex:1' }, { clearRest: true });
  });

  it('routes config volume commands', () => {
    renderHook(() => useExternalControl());
    act(() => {
      capturedCallback({
        topic: 'client-control:c1',
        commandId: 'cmd3',
        command: 'config',
        params: { setting: 'volume', value: 80 },
      });
    });
    expect(setVolumeFn).toHaveBeenCalledWith(80);
  });

  it('routes adopt-snapshot commands', () => {
    renderHook(() => useExternalControl());
    const snap = { sessionId: 'x', state: 'paused' };
    act(() => {
      capturedCallback({
        topic: 'client-control:c1',
        commandId: 'cmd4',
        command: 'adopt-snapshot',
        params: { snapshot: snap, autoplay: false },
      });
    });
    expect(adoptFn).toHaveBeenCalledWith(snap, { autoplay: false });
  });

  it('sends an ack frame after every handled command', () => {
    renderHook(() => useExternalControl());
    act(() => {
      capturedCallback({
        topic: 'client-control:c1',
        commandId: 'cmd5',
        command: 'transport',
        params: { action: 'play' },
      });
    });
    expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'client-ack',
      clientId: 'c1',
      commandId: 'cmd5',
      ok: true,
    }));
  });
});
