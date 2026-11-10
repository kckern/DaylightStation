import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ handler: null, info: vi.fn() }));
vi.mock('../../../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handler = cb; },
}));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: h.info, debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));
vi.mock('./kioskDeviceIdentity.js', () => ({ KIOSK_DEVICE_ID: 'yellow-room-tablet' }));

import { usePianoSpeakerHelp, PIANO_SPEAKER_TOPIC } from './usePianoSpeakerHelp.js';

const msg = (state, told = false, deviceId = 'yellow-room-tablet') => ({ topic: 'piano.speaker', deviceId, state, rung: 5, told });

describe('usePianoSpeakerHelp', () => {
  beforeEach(() => h.info.mockClear());

  it('listens on piano.speaker', () => {
    expect(PIANO_SPEAKER_TOPIC).toBe('piano.speaker');
  });

  it('is quiet until this kiosk is told needs-help, and clears on ok', () => {
    const { result } = renderHook(() => usePianoSpeakerHelp());
    expect(result.current).toEqual({ needsHelp: false, told: false });
    act(() => h.handler(msg('recovering')));
    expect(result.current.needsHelp).toBe(false); // silent while recovering
    act(() => h.handler(msg('needs-help', true)));
    expect(result.current).toEqual({ needsHelp: true, told: true });
    act(() => h.handler(msg('ok')));
    expect(result.current).toEqual({ needsHelp: false, told: false });
  });

  it('carries whether a person was actually told', () => {
    const { result } = renderHook(() => usePianoSpeakerHelp());
    act(() => h.handler(msg('needs-help', false)));
    expect(result.current).toEqual({ needsHelp: true, told: false });
  });

  it('ignores another device', () => {
    const { result } = renderHook(() => usePianoSpeakerHelp());
    act(() => h.handler(msg('needs-help', true, 'other-tablet')));
    expect(result.current.needsHelp).toBe(false);
  });

  it('logs each banner transition exactly once, even under StrictMode', () => {
    renderHook(() => usePianoSpeakerHelp(), { wrapper: StrictMode });
    act(() => h.handler(msg('needs-help', true)));
    act(() => h.handler(msg('needs-help', true))); // re-published every tick
    act(() => h.handler(msg('ok')));
    expect(h.info.mock.calls.map((c) => c[0])).toEqual(['piano.speaker-banner.shown', 'piano.speaker-banner.cleared']);
  });
});
