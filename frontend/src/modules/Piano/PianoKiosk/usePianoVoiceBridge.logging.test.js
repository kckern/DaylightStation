import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logging framework so we can assert on emitted transport events
// without coupling to its internals. The child() logger is a bag of spies.
const logSpies = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpies }),
}));

import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; FakeWS.instances.push(this); FakeWS.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(evt) { this.readyState = 3; this.onclose?.(evt ?? {}); }
  _open() { this.readyState = 1; this.onopen?.(); }
  _msg(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  _error() { this.onerror?.({}); }
}
FakeWS.OPEN = 1;
FakeWS.instances = [];

beforeEach(() => {
  FakeWS.instances = [];
  FakeWS.last = undefined;
  global.WebSocket = FakeWS;
  Object.values(logSpies).forEach((s) => s.mockClear());
});
afterEach(() => { vi.useRealTimers(); });

describe('usePianoVoiceBridge transport logging', () => {
  it('logs bridge.connecting on the initial connection attempt', () => {
    renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    expect(logSpies.info).toHaveBeenCalledWith(
      'bridge.connecting',
      expect.objectContaining({ url: 'ws://localhost:8770', attempt: 0 }),
    );
  });

  it('logs bridge.open with the attempt count that was used before reset', () => {
    vi.useFakeTimers();
    renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    // First open takes zero retries.
    expect(logSpies.info).toHaveBeenCalledWith('bridge.open', expect.objectContaining({ attempts: 0 }));
  });

  it('logs bridge.closed with willReconnect:true on an unexpected close', () => {
    vi.useFakeTimers();
    renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    act(() => FakeWS.last.close({ code: 1006, reason: 'abnormal', wasClean: false }));
    expect(logSpies.warn).toHaveBeenCalledWith(
      'bridge.closed',
      expect.objectContaining({ code: 1006, reason: 'abnormal', wasClean: false, willReconnect: true }),
    );
    expect(logSpies.info).toHaveBeenCalledWith(
      'bridge.reconnect-scheduled',
      expect.objectContaining({ url: 'ws://localhost:8770', delayMs: 250 }),
    );
  });

  it('logs bridge.closed with willReconnect:false on unmount cleanup', () => {
    const { unmount } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    act(() => unmount());
    expect(logSpies.warn).toHaveBeenCalledWith(
      'bridge.closed',
      expect.objectContaining({ willReconnect: false }),
    );
    expect(logSpies.info).not.toHaveBeenCalledWith('bridge.reconnect-scheduled', expect.anything());
  });

  it('logs bridge.socket-error on ws.onerror without scheduling a reconnect', () => {
    vi.useFakeTimers();
    renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    act(() => FakeWS.last._error());
    expect(logSpies.error).toHaveBeenCalledWith('bridge.socket-error', { url: 'ws://localhost:8770' });
    expect(logSpies.info).not.toHaveBeenCalledWith('bridge.reconnect-scheduled', expect.anything());
  });

  it('logs bridge.send on a successful outbound frame', () => {
    const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    act(() => result.current.panic());
    expect(logSpies.debug).toHaveBeenCalledWith('bridge.send', { type: 'panic' });
  });

  it('logs bridge.send-no-link (not bridge.send) when there is no link', () => {
    const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    // Socket never opened → readyState != 1.
    act(() => result.current.panic());
    expect(logSpies.warn).toHaveBeenCalledWith('bridge.send-no-link', { type: 'panic' });
    expect(logSpies.debug).not.toHaveBeenCalledWith('bridge.send', expect.anything());
  });
});
