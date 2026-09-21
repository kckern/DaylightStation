import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useControlRegistration } from './useControlRegistration.js';

function service() {
  let messageListener;
  let statusListener;
  return {
    subscribe: vi.fn((filter, callback) => {
      messageListener = { filter, callback };
      return vi.fn();
    }),
    onStatusChange: vi.fn((callback) => {
      statusListener = callback;
      callback({ connected: false, connecting: false });
      return vi.fn();
    }),
    sendEphemeral: vi.fn(() => true),
    message: (msg) => messageListener.callback(msg),
    status: (status) => statusListener(status),
  };
}

describe('useControlRegistration', () => {
  afterEach(() => vi.useRealTimers());
  it('subscribes before identify and becomes ready only for its matching acknowledged attempt', () => {
    const ws = service();
    const { result } = renderHook(() => useControlRegistration('live-a', { service: ws, createNonce: () => 'nonce-1' }));

    act(() => ws.status({ connected: true, connecting: false }));
    expect(ws.subscribe).toHaveBeenCalledBefore(ws.sendEphemeral);
    expect(ws.sendEphemeral).toHaveBeenCalledWith({ type: 'identify', clientId: 'live-a', nonce: 'nonce-1' });
    expect(result.current.ready).toBe(false);

    act(() => ws.message({ type: 'identify_ack', clientId: 'other', nonce: 'nonce-1', ok: true }));
    act(() => ws.message({ type: 'identify_ack', clientId: 'live-a', nonce: 'stale', ok: true }));
    act(() => ws.message({ type: 'identify_ack', clientId: 'live-a', nonce: 'nonce-1', ok: false, code: 'IN_USE' }));
    expect(result.current.ready).toBe(false);

    act(() => ws.message({ type: 'identify_ack', clientId: 'live-a', nonce: 'nonce-1', ok: true }));
    expect(result.current.ready).toBe(true);
  });

  it('clears ready on disconnect and rejects a prior attempt acknowledgement after reconnect', () => {
    const ws = service();
    const nonce = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second');
    const { result } = renderHook(() => useControlRegistration('live-a', { service: ws, createNonce: nonce }));

    act(() => ws.status({ connected: true }));
    act(() => ws.message({ type: 'identify_ack', clientId: 'live-a', nonce: 'first', ok: true }));
    expect(result.current.ready).toBe(true);

    act(() => ws.status({ connected: false }));
    expect(result.current.ready).toBe(false);
    act(() => ws.status({ connected: true }));
    act(() => ws.message({ type: 'identify_ack', clientId: 'live-a', nonce: 'first', ok: true }));
    expect(result.current.ready).toBe(false);
    act(() => ws.message({ type: 'identify_ack', clientId: 'live-a', nonce: 'second', ok: true }));
    expect(result.current.ready).toBe(true);
  });

  it('keeps retrying a duplicate claim through a bounded stale-owner window, then becomes ready', () => {
    vi.useFakeTimers();
    const ws = service();
    const nonce = vi.fn().mockReturnValueOnce('claim-1').mockReturnValueOnce('claim-2');
    const { result, unmount } = renderHook(() => useControlRegistration('live-a', {
      service: ws, createNonce: nonce, retryMs: 1000, maxRetries: 130,
    }));

    act(() => ws.status({ connected: true }));
    act(() => ws.message({ type: 'identify_ack', clientId: 'live-a', nonce: 'claim-1', ok: false, code: 'IDENTITY_IN_USE' }));
    expect(result.current.ready).toBe(false);

    act(() => vi.advanceTimersByTime(1000));
    expect(ws.sendEphemeral).toHaveBeenLastCalledWith({ type: 'identify', clientId: 'live-a', nonce: 'claim-2' });
    act(() => ws.message({ type: 'identify_ack', clientId: 'live-a', nonce: 'claim-2', ok: true }));
    expect(result.current.ready).toBe(true);

    unmount();
    expect(ws.sendEphemeral).toHaveBeenLastCalledWith({ type: 'identify_release', clientId: 'live-a' });
  });
});
