import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; FakeWS.instances.push(this); FakeWS.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.onclose?.({}); }
  _open() { this.readyState = 1; this.onopen?.(); }
  _msg(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
FakeWS.OPEN = 1;
FakeWS.instances = [];

beforeEach(() => { FakeWS.instances = []; FakeWS.last = undefined; global.WebSocket = FakeWS; });
afterEach(() => { vi.useRealTimers(); });

describe('usePianoVoiceBridge', () => {
  it('loads a preset and reflects status from the APK', async () => {
    const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    act(() => result.current.loadPreset({ id: 'g', engine: 'sfizz', asset: 'x.sfz' }));
    expect(FakeWS.last.sent).toContainEqual({ type: 'engine.start' });
    expect(FakeWS.last.sent.find(m => m.type === 'preset.load').spec.id).toBe('g');
    act(() => FakeWS.last._msg({ type: 'status', engine: 'running', preset: 'g' }));
    await waitFor(() => expect(result.current.status.preset).toBe('g'));
    expect(result.current.status.engine).toBe('running');
  });

  it('stop sends engine.stop', () => {
    const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    act(() => result.current.stop());
    expect(FakeWS.last.sent).toContainEqual({ type: 'engine.stop' });
  });

  it('setParam and panic send the expected messages', () => {
    const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    act(() => result.current.setParam('voice.gain', 0.5));
    act(() => result.current.panic());
    expect(FakeWS.last.sent).toContainEqual({ type: 'param.set', path: 'voice.gain', value: 0.5 });
    expect(FakeWS.last.sent).toContainEqual({ type: 'panic' });
  });

  it('reports link=connected on open', () => {
    const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    expect(result.current.status.link).toBe('idle');
    act(() => FakeWS.last._open());
    expect(result.current.status.link).toBe('connected');
  });

  it('does not connect when enabled is false', () => {
    renderHook(() => usePianoVoiceBridge({ enabled: false }));
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('reconnects with backoff after an unexpected close', () => {
    vi.useFakeTimers();
    renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    expect(FakeWS.instances).toHaveLength(1);
    act(() => FakeWS.last._open());
    act(() => FakeWS.last.close());
    // No reconnect before the backoff delay elapses.
    expect(FakeWS.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(250); });
    expect(FakeWS.instances).toHaveLength(2);
  });

  it('sets link=reconnecting after an unexpected close', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    expect(result.current.status.link).toBe('connected');
    act(() => FakeWS.last.close());
    expect(result.current.status.link).toBe('reconnecting');
  });

  it('closes the old socket and opens a new one when url changes', () => {
    const { rerender } = renderHook(
      ({ url }) => usePianoVoiceBridge({ url }),
      { initialProps: { url: 'ws://localhost:8770' } },
    );
    const first = FakeWS.last;
    act(() => first._open());
    expect(FakeWS.instances).toHaveLength(1);
    rerender({ url: 'ws://localhost:9999' });
    expect(first.readyState).toBe(3); // old socket closed by effect teardown
    expect(FakeWS.instances).toHaveLength(2);
    expect(FakeWS.last.url).toBe('ws://localhost:9999');
  });

  it('ignores a malformed (non-JSON) message without throwing or changing status', () => {
    const { result } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    act(() => FakeWS.last._open());
    const before = result.current.status;
    expect(() => act(() => FakeWS.last.onmessage?.({ data: 'not json{' }))).not.toThrow();
    expect(result.current.status).toEqual(before);
  });

  it('does not reconnect after unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => usePianoVoiceBridge({ url: 'ws://localhost:8770' }));
    expect(FakeWS.instances).toHaveLength(1);
    unmount();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(FakeWS.instances).toHaveLength(1);
  });
});
