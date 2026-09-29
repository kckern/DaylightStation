import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeFn = vi.fn();
const sendFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: (...a) => sendFn(...a), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
  default: { send: (...a) => sendFn(...a), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
}));

vi.mock('../identity/useClientIdentity.js', () => ({
  useClientIdentity: vi.fn(() => ({ clientId: 'profile-1', controlClientId: 'live-1', controlReady: true, displayName: 'D' })),
}));

import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { useExternalControl } from './useExternalControl.js';

function makeController() {
  return {
    transport: { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
    queue: { playNow: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn(), remove: vi.fn(), reorder: vi.fn(), jump: vi.fn(), clear: vi.fn() },
    config: { setShuffle: vi.fn(), setRepeat: vi.fn(), setShader: vi.fn(), setVolume: vi.fn() },
    lifecycle: { reset: vi.fn(), adoptSnapshot: vi.fn() },
    setOrigin: vi.fn(),
  };
}

let capturedFilter = null;
let capturedCallback = null;
let controller;
beforeEach(() => {
  sessionStorage.clear();
  controller = makeController();
  subscribeFn.mockReset().mockImplementation((filter, cb) => {
    capturedFilter = filter;
    capturedCallback = cb;
    return () => {};
  });
  sendFn.mockReset();
});

describe('useExternalControl', () => {
  it('subscribes with a filter matching only the registered live control identity', () => {
    renderHook(() => useExternalControl(controller));
    expect(typeof capturedFilter).toBe('function');
    expect(capturedFilter({ topic: 'client-control:live-1' })).toBe(true);
    expect(capturedFilter({ topic: 'client-control:other' })).toBe(false);
  });

  it('routes transport commands and acks ok', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:live-1', replyToControlClientId: 'caller-live', commandId: 'cmd1', command: 'transport', params: { action: 'pause' } });
    });
    expect(controller.transport.pause).toHaveBeenCalled();
    expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'client-ack', clientId: 'live-1', replyToControlClientId: 'caller-live', commandId: 'cmd1', ok: true,
    }));
  });

  it('routes queue play-now commands', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:live-1', commandId: 'cmd2', command: 'queue', params: { op: 'play-now', contentId: 'plex:1', clearRest: true } });
    });
    expect(controller.queue.playNow).toHaveBeenCalledWith({ contentId: 'plex:1' }, { clearRest: true });
  });

  it('routes adopt-snapshot commands', () => {
    renderHook(() => useExternalControl(controller));
    const snap = createIdleSessionSnapshot({ sessionId: 'x', ownerId: 'c9' });
    act(() => {
      capturedCallback({ topic: 'client-control:live-1', commandId: 'cmd4', command: 'adopt-snapshot', params: { snapshot: snap, autoplay: false } });
    });
    expect(controller.lifecycle.adoptSnapshot).toHaveBeenCalledWith(snap, { autoplay: false });
  });

  it('acks not-ok with a reason for invalid envelopes', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:live-1', commandId: 'cmd5', command: 'transport', params: { action: 'explode' } });
    });
    expect(controller.transport.play).not.toHaveBeenCalled();
    expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'client-ack', commandId: 'cmd5', ok: false,
    }));
  });

  it('returns typed unsupported for a valid handoff instead of a receipt-only success', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:live-1', replyToControlClientId: 'caller-live', commandId: 'handoff-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'capture' } });
    });
    expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'client-ack', commandId: 'handoff-1', ok: false, code: 'HANDOFF_UNSUPPORTED',
      handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' },
    }));
    expect(controller.transport.stop).not.toHaveBeenCalled();
  });

  it('ignores messages without a commandId', () => {
    renderHook(() => useExternalControl(controller));
    act(() => {
      capturedCallback({ topic: 'client-control:live-1', command: 'transport', params: { action: 'play' } });
    });
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('suppresses a repeated routine trigger for 10s but never suppresses a later human command', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    const { unmount } = renderHook(() => useExternalControl(controller));
    const routine = commandId => ({
      topic: 'client-control:live-1', replyToControlClientId: 'caller-live', commandId,
      command: 'queue', params: { op: 'play-now', contentId: 'plex:1' },
      origin: { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' },
    });
    act(() => {
      capturedCallback(routine('routine-1'));
      capturedCallback(routine('routine-2'));
      capturedCallback({ ...routine('human-1'), origin: { kind: 'device', id: 'browser:caller' } });
    });
    expect(controller.queue.playNow).toHaveBeenCalledTimes(2);
    expect(sendFn).toHaveBeenCalledTimes(3);
    unmount();
    vi.useRealTimers();
  });

  it('acks a duplicate routine with its own commandId and caches that duplicate for later retries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    const { unmount } = renderHook(() => useExternalControl(controller));
    const routine = commandId => ({
      topic: 'client-control:live-1', replyToControlClientId: 'caller-live', commandId,
      command: 'queue', params: { op: 'play-now', contentId: 'plex:1' },
      origin: { kind: 'routine', name: 'Breakfast', triggerId: 'daily-idempotent' },
    });

    act(() => {
      capturedCallback(routine('routine-original'));
      capturedCallback(routine('routine-duplicate'));
    });
    vi.advanceTimersByTime(10_001);
    act(() => capturedCallback(routine('routine-duplicate')));

    expect(controller.queue.playNow).toHaveBeenCalledOnce();
    expect(sendFn.mock.calls.map(([message]) => message.commandId)).toEqual([
      'routine-original', 'routine-duplicate', 'routine-duplicate',
    ]);
    expect(sendFn.mock.calls.every(([message]) => message.ok === true)).toBe(true);
    unmount();
    vi.useRealTimers();
  });

  it('does not poison routine retries when the first application is rejected', () => {
    controller.transport.play = undefined;
    renderHook(() => useExternalControl(controller));
    const command = commandId => ({
      topic: 'client-control:live-1', replyToControlClientId: 'caller-live', commandId,
      command: 'transport', params: { action: 'play' },
      origin: { kind: 'routine', name: 'Breakfast', triggerId: 'daily-failure' },
    });
    act(() => capturedCallback(command('failed-1')));
    controller.transport.play = vi.fn();
    act(() => capturedCallback(command('retry-2')));
    expect(controller.transport.play).toHaveBeenCalledOnce();
    expect(sendFn).toHaveBeenLastCalledWith(expect.objectContaining({ commandId: 'retry-2', ok: true }));
  });

  it('retains the successful routine dedupe window across a browser-app remount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    const command = commandId => ({
      topic: 'client-control:live-1', commandId, command: 'queue',
      params: { op: 'play-now', contentId: 'plex:reload' },
      origin: { kind: 'routine', name: 'Breakfast', triggerId: 'reload-trigger' },
    });
    const first = renderHook(() => useExternalControl(controller));
    act(() => capturedCallback(command('before-reload')));
    first.unmount();
    renderHook(() => useExternalControl(controller));
    act(() => capturedCallback(command('after-reload')));

    expect(controller.queue.playNow).toHaveBeenCalledOnce();
    expect(sendFn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('replays an identical commandId without re-executing, even for human origin', () => {
    renderHook(() => useExternalControl(controller));
    const msg = { topic: 'client-control:live-1', replyToControlClientId: 'caller-live', commandId: 'h-1',
      command: 'transport', params: { action: 'pause' }, origin: { kind: 'device', id: 'browser:x' } };
    act(() => { capturedCallback(msg); capturedCallback(msg); });
    expect(controller.transport.pause).toHaveBeenCalledOnce();
    expect(sendFn.mock.calls.map(([m]) => [m.commandId, m.ok])).toEqual([['h-1', true], ['h-1', true]]);
  });

  it('evicts the oldest cached result past 256 commands', () => {
    renderHook(() => useExternalControl(controller));
    const msg = id => ({ topic: 'client-control:live-1', replyToControlClientId: 'c', commandId: id,
      command: 'transport', params: { action: 'pause' } });
    act(() => { for (let i = 0; i <= 256; i += 1) capturedCallback(msg(`c-${i}`)); });
    act(() => capturedCallback(msg('c-0')));
    expect(controller.transport.pause).toHaveBeenCalledTimes(258);
  });

  it('acks a rejected command replay with the same failure, not success', () => {
    controller.transport.pause.mockImplementation(() => { throw new Error('no-media'); });
    renderHook(() => useExternalControl(controller));
    const msg = { topic: 'client-control:live-1', replyToControlClientId: 'c', commandId: 'r-1',
      command: 'transport', params: { action: 'pause' } };
    act(() => { capturedCallback(msg); capturedCallback(msg); });
    expect(sendFn.mock.calls.map(([m]) => m.ok)).toEqual([false, false]);
  });
});
