import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { ScreenVolumeContext } from '../lib/volume/ScreenVolumeContext.js';
import { PortalKeysBridge } from './PortalKeysBridge.jsx';

// ── Fake WebSocket ───────────────────────────────────────────────────────────
// Captures every instance so tests can drive onmessage/onclose directly.

let sockets = [];

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.closed = false;
    sockets.push(this);
  }
  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }
  emit(obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
  }
  emitRaw(data) {
    if (this.onmessage) this.onmessage({ data });
  }
  fireClose() {
    if (this.onclose) this.onclose();
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

function renderBridge({ config, step = vi.fn(), stepSize = 0.1 }) {
  const value = {
    master: 0.5,
    effectiveMaster: 0.5,
    muted: false,
    setMaster: vi.fn(),
    step,
    toggleMute: vi.fn(),
    stepSize,
  };
  const utils = render(
    <ScreenVolumeContext.Provider value={value}>
      <PortalKeysBridge config={config} />
    </ScreenVolumeContext.Provider>
  );
  return { ...utils, step };
}

describe('usePortalKeys / PortalKeysBridge', () => {
  beforeEach(() => {
    sockets = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not open a socket unless explicitly enabled', () => {
    renderBridge({ config: undefined });
    expect(sockets).toHaveLength(0);

    renderBridge({ config: { enabled: false } });
    expect(sockets).toHaveLength(0);
  });

  it('connects to the configured port on localhost when enabled', () => {
    renderBridge({ config: { enabled: true, port: 9999 } });
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://localhost:9999/');
  });

  it('defaults to port 8771', () => {
    renderBridge({ config: { enabled: true } });
    expect(sockets[0].url).toBe('ws://localhost:8771/');
  });

  it('steps volume up by stepSize on VOLUME_UP', () => {
    const { step } = renderBridge({ config: { enabled: true }, stepSize: 0.1 });
    act(() => {
      sockets[0].open();
      sockets[0].emit({ type: 'key', key: 'KEYCODE_VOLUME_UP', action: 'down' });
    });
    expect(step).toHaveBeenCalledWith(0.1);
  });

  it('steps volume down by stepSize on VOLUME_DOWN', () => {
    const { step } = renderBridge({ config: { enabled: true }, stepSize: 0.05 });
    act(() => {
      sockets[0].open();
      sockets[0].emit({ type: 'key', key: 'KEYCODE_VOLUME_DOWN', action: 'down' });
    });
    expect(step).toHaveBeenCalledWith(-0.05);
  });

  // The camera button is the APK's job — it must work when this WebView is dozing
  // or wedged, so the SPA must never be the thing that acts on it.
  it('does NOT touch volume on MUTE (screen toggle is native)', () => {
    const { step } = renderBridge({ config: { enabled: true } });
    act(() => {
      sockets[0].open();
      sockets[0].emit({ type: 'key', key: 'KEYCODE_MUTE', action: 'down' });
      sockets[0].emit({ type: 'key', key: 'KEYCODE_VOLUME_MUTE', action: 'down' });
    });
    expect(step).not.toHaveBeenCalled();
  });

  it('ignores non-key messages and malformed payloads', () => {
    const { step } = renderBridge({ config: { enabled: true } });
    act(() => {
      sockets[0].open();
      sockets[0].emit({ type: 'ready', port: 8771 });
      sockets[0].emitRaw('not json at all');
    });
    expect(step).not.toHaveBeenCalled();
  });

  it('reconnects after the socket closes', () => {
    renderBridge({ config: { enabled: true } });
    expect(sockets).toHaveLength(1);

    act(() => { sockets[0].fireClose(); });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(sockets).toHaveLength(2);
  });

  it('backs off exponentially so non-Portal screens stay cheap', () => {
    renderBridge({ config: { enabled: true } });

    // 1st retry at 1s
    act(() => { sockets[0].fireClose(); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(sockets).toHaveLength(2);

    // 2nd retry should NOT have fired at another 1s — backoff doubled to 2s.
    act(() => { sockets[1].fireClose(); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(sockets).toHaveLength(2);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(sockets).toHaveLength(3);
  });

  it('stops reconnecting after unmount', () => {
    const { unmount } = renderBridge({ config: { enabled: true } });
    const first = sockets[0];

    unmount();
    act(() => { first.fireClose(); });
    act(() => { vi.advanceTimersByTime(60000); });

    expect(sockets).toHaveLength(1);
    expect(first.closed).toBe(true);
  });
});
