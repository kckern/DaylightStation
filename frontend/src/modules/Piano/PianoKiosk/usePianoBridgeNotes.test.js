import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

import { usePianoBridgeNotes } from './usePianoBridgeNotes.js';

// Controllable fake WebSocket: captures the most recently constructed instance
// so a test can fire onopen/onmessage/onclose the way the real socket would.
function installFakeWebSocket() {
  const instances = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.closed = false;
      instances.push(this);
    }
    close() { this.closed = true; this.onclose?.({ code: 1000, wasClean: true }); }
    send() {}
  }
  global.WebSocket = FakeWebSocket;
  return instances;
}

describe('usePianoBridgeNotes', () => {
  let instances;

  beforeEach(() => {
    instances = installFakeWebSocket();
  });

  it('calls onNote with note_on for a note.on frame', async () => {
    const onNote = vi.fn();
    renderHook(() => usePianoBridgeNotes({ onNote }));
    const ws = instances[0];
    await act(async () => {
      ws.onopen?.();
      ws.onmessage?.({ data: JSON.stringify({ type: 'note.on', note: 60, velocity: 100 }) });
    });
    expect(onNote).toHaveBeenCalledWith('note_on', 60, 100);
  });

  it('calls onNote with note_off for a note.off frame', async () => {
    const onNote = vi.fn();
    renderHook(() => usePianoBridgeNotes({ onNote }));
    const ws = instances[0];
    await act(async () => {
      ws.onopen?.();
      ws.onmessage?.({ data: JSON.stringify({ type: 'note.off', note: 60 }) });
    });
    expect(onNote).toHaveBeenCalledWith('note_off', 60, 0);
  });

  it('does not throw on malformed JSON', async () => {
    const onNote = vi.fn();
    renderHook(() => usePianoBridgeNotes({ onNote }));
    const ws = instances[0];
    expect(() => {
      ws.onmessage?.({ data: '{not json' });
    }).not.toThrow();
    expect(onNote).not.toHaveBeenCalled();
  });

  it('sets link to connected after onopen', async () => {
    const { result } = renderHook(() => usePianoBridgeNotes());
    expect(result.current.link).toBe('connecting');
    const ws = instances[0];
    await act(async () => { ws.onopen?.(); });
    expect(result.current.link).toBe('connected');
  });

  it('marks the bridge unavailable after two closes with no open, once the grace window elapses (no-bridge client)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => usePianoBridgeNotes());
      expect(result.current.unavailable).toBe(false); // first attempt — bridge-first grace

      await act(async () => { instances[0].onclose?.({ code: 1006 }); }); // fail 1 → reconnect scheduled
      expect(result.current.unavailable).toBe(false); // still in grace after one fail

      // Let the backoff timer fire → a second socket is constructed.
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(instances.length).toBe(2);

      await act(async () => { instances[1].onclose?.({ code: 1006 }); }); // fail 2, still never opened
      // Two failures alone are NOT enough — the startup grace must also elapse,
      // so an APK WS server that is merely slow to boot isn't misread as absent.
      expect(result.current.unavailable).toBe(false);

      await act(async () => { await vi.advanceTimersByTimeAsync(8000); }); // grace expires
      expect(result.current.unavailable).toBe(true); // no bridge → fall back to Web MIDI
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds output-only through the grace window despite an early failure burst (boot-race guard)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => usePianoBridgeNotes());

      // Simulate the APK WS server still starting: a burst of quick failures.
      await act(async () => { instances[0].onclose?.({ code: 1006 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await act(async () => { instances[instances.length - 1].onclose?.({ code: 1006 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      await act(async () => { instances[instances.length - 1].onclose?.({ code: 1006 }); });

      // Well within the grace window: still NOT unavailable, so the kiosk stays
      // output-only and lets the APK win the single-connection BLE race.
      expect(result.current.unavailable).toBe(false);

      // The bridge finally comes up before grace expiry → permanently available.
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await act(async () => { instances[instances.length - 1].onopen?.(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
      expect(result.current.unavailable).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays available once the bridge has opened, even if it later closes', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => usePianoBridgeNotes());
      await act(async () => { instances[0].onopen?.(); }); // bridge is real
      expect(result.current.unavailable).toBe(false);

      await act(async () => { instances[0].onclose?.({ code: 1006 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await act(async () => { instances[instances.length - 1].onclose?.({ code: 1006 }); });
      expect(result.current.unavailable).toBe(false); // everConnected → never flip to unavailable
    } finally {
      vi.useRealTimers();
    }
  });
});
