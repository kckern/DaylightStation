import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ handler: null }));
vi.mock('../../../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handler = cb; },
}));
vi.mock('./kioskDeviceIdentity.js', () => ({ KIOSK_DEVICE_ID: 'yellow-room-tablet' }));

import { usePianoSpeakerHelp, PIANO_SPEAKER_TOPIC } from './usePianoSpeakerHelp.js';

describe('usePianoSpeakerHelp', () => {
  it('listens on piano.speaker', () => {
    expect(PIANO_SPEAKER_TOPIC).toBe('piano.speaker');
  });

  it('is false until this kiosk is told needs-help, and clears on ok', () => {
    const { result } = renderHook(() => usePianoSpeakerHelp());
    expect(result.current).toBe(false);
    act(() => h.handler({ topic: 'piano.speaker', deviceId: 'yellow-room-tablet', state: 'recovering', rung: 2 }));
    expect(result.current).toBe(false); // silent while recovering
    act(() => h.handler({ topic: 'piano.speaker', deviceId: 'yellow-room-tablet', state: 'needs-help', rung: 5 }));
    expect(result.current).toBe(true);
    act(() => h.handler({ topic: 'piano.speaker', deviceId: 'yellow-room-tablet', state: 'ok', rung: 5 }));
    expect(result.current).toBe(false);
  });

  it('ignores another device', () => {
    const { result } = renderHook(() => usePianoSpeakerHelp());
    act(() => h.handler({ topic: 'piano.speaker', deviceId: 'other-tablet', state: 'needs-help', rung: 5 }));
    expect(result.current).toBe(false);
  });
});
