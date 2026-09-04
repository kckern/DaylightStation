import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// One shared spy set, so a test can assert WHICH level a given situation logs
// at. `sampled` is part of the real child-logger surface (Logger.js) and was
// missing here; the hook now uses it for the bridgeless steady state, and a
// mock without it throws "logger(...).sampled is not a function" from inside a
// socket callback — where it surfaces as an unrelated-looking failure.
const logSpy = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy }),
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
    Object.values(logSpy).forEach((fn) => fn.mockClear());
  });

  // A browser with no bridge on it (a laptop, not the kiosk tablet) retried
  // every 5s forever and logged `bridge.socket-error` at ERROR each time:
  // 1,018 rows an hour in production from about one open tab, which is enough
  // to push real errors out of the log store's retention window. Once the
  // client is judged bridge-less the socket failure IS the steady state, so it
  // must stop being reported as an error and must stop retrying so hard.
  describe('a client with no bridge stops shouting', () => {
    const failOnce = async (ws) => {
      await act(async () => {
        ws.onerror?.();
        ws.onclose?.({ code: 1006, wasClean: false });
      });
    };

    it('logs socket errors at error level while the bridge is still plausible', async () => {
      renderHook(() => usePianoBridgeNotes());
      await failOnce(instances[0]);
      // Inside the grace window: a real bridge may still be starting up.
      expect(logSpy.error).toHaveBeenCalledWith('bridge.socket-error', expect.anything());
      expect(logSpy.sampled).not.toHaveBeenCalled();
    });

    it('drops to a sampled event once the grace window has expired unconnected', async () => {
      vi.useFakeTimers();
      try {
        renderHook(() => usePianoBridgeNotes());
        // Past UNAVAILABLE_GRACE_MS with no successful open.
        await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
        logSpy.error.mockClear();
        logSpy.sampled.mockClear();

        await failOnce(instances[instances.length - 1]);

        expect(logSpy.error).not.toHaveBeenCalled();
        expect(logSpy.sampled).toHaveBeenCalledWith(
          'bridge.socket-error.bridgeless',
          expect.anything(),
          expect.objectContaining({ maxPerMinute: 1 }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps reporting errors for a bridge that HAS connected, so a kiosk drop still alerts', async () => {
      vi.useFakeTimers();
      try {
        renderHook(() => usePianoBridgeNotes());
        await act(async () => { instances[0].onopen?.(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
        logSpy.error.mockClear();
        logSpy.sampled.mockClear();

        await failOnce(instances[instances.length - 1]);

        // everConnected wins over the expired grace: the APK restarting on the
        // kiosk tablet is a real failure and must not be silenced.
        expect(logSpy.error).toHaveBeenCalledWith('bridge.socket-error', expect.anything());
        expect(logSpy.sampled).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('backs off past the 5s ceiling once judged bridge-less', async () => {
      vi.useFakeTimers();
      try {
        renderHook(() => usePianoBridgeNotes());
        await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
        // Drive enough failures that the exponential term exceeds 5s.
        for (let i = 0; i < 8; i++) {
          await failOnce(instances[instances.length - 1]);
          await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
        }
        const delays = logSpy.sampled.mock.calls
          .filter(([name]) => name === 'bridge.reconnect-scheduled.bridgeless')
          .map(([, data]) => data.delayMs);
        expect(delays.length).toBeGreaterThan(0);
        // The old ceiling was 5000; a bridgeless client must be allowed past it.
        expect(Math.max(...delays)).toBeGreaterThan(5000);
      } finally {
        vi.useRealTimers();
      }
    });
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

  it('defaults speakerConnected to true', async () => {
    const { result } = renderHook(() => usePianoBridgeNotes());
    expect(result.current.speakerConnected).toBe(true);
  });

  it('stays true after fewer than 3 consecutive speakerOk:false heartbeats', async () => {
    const { result } = renderHook(() => usePianoBridgeNotes());
    const ws = instances[0];
    await act(async () => { ws.onopen?.(); });
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    });
    expect(result.current.speakerConnected).toBe(true);
  });

  it('flips to false after 3 consecutive speakerOk:false heartbeats', async () => {
    const { result } = renderHook(() => usePianoBridgeNotes());
    const ws = instances[0];
    await act(async () => { ws.onopen?.(); });
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    });
    expect(result.current.speakerConnected).toBe(false);
  });

  it('recovers to true instantly on a single speakerOk:true after being false', async () => {
    const { result } = renderHook(() => usePianoBridgeNotes());
    const ws = instances[0];
    await act(async () => { ws.onopen?.(); });
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    });
    expect(result.current.speakerConnected).toBe(false);
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: true }) });
    });
    expect(result.current.speakerConnected).toBe(true);
  });

  it('resets the consecutive counter when a speakerOk:true interrupts', async () => {
    const { result } = renderHook(() => usePianoBridgeNotes());
    const ws = instances[0];
    await act(async () => { ws.onopen?.(); });
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
      // Interrupted — counter resets
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: true }) });
      // Start over
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
      ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    });
    expect(result.current.speakerConnected).toBe(true); // only 2 consecutive, not 3
  });

  it('stays true when the bridge is unavailable (non-kiosk client)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => usePianoBridgeNotes());
      await act(async () => { instances[0].onclose?.({ code: 1006 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await act(async () => { instances[1].onclose?.({ code: 1006 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
      expect(result.current.unavailable).toBe(true);
      expect(result.current.speakerConnected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
