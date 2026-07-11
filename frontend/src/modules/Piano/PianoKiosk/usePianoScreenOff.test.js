import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared spies + mutable config, hoisted so the vi.mock factories can close over them.
const h = vi.hoisted(() => ({
  turnOffScreen: vi.fn(() => Promise.resolve({ ok: true })),
  beginScreenOffCooldown: vi.fn(),
  setCurrentUser: vi.fn(),
  DaylightAPI: vi.fn(() => Promise.resolve({})),
  config: { screensaver: { offCooldownMinutes: 20, deviceId: 'piano-tablet' } },
}));

vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: h.config }) }));
vi.mock('./useScreenControl.js', () => ({ useScreenControl: () => ({ turnOffScreen: h.turnOffScreen }) }));
vi.mock('./usePianoScreensaver.jsx', () => ({ useScreenOffCooldown: () => h.beginScreenOffCooldown }));
vi.mock('./PianoUserContext.jsx', () => ({ usePianoUser: () => ({ setCurrentUser: h.setCurrentUser }), default: {} }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: h.DaylightAPI }));

import { usePianoScreenOff } from './usePianoScreenOff.js';

describe('usePianoScreenOff', () => {
  beforeEach(() => {
    h.turnOffScreen.mockClear();
    h.beginScreenOffCooldown.mockClear();
    h.setCurrentUser.mockClear();
    h.DaylightAPI.mockClear();
    h.config = { screensaver: { offCooldownMinutes: 20, deviceId: 'piano-tablet' } };
  });

  it('turns off the backlight, arms the cooldown, suppresses device wake, and drops to guest', async () => {
    const { result } = renderHook(() => usePianoScreenOff());
    await act(async () => { await result.current(); });

    expect(h.turnOffScreen).toHaveBeenCalledTimes(1);
    expect(h.beginScreenOffCooldown).toHaveBeenCalledTimes(1);
    expect(h.DaylightAPI).toHaveBeenCalledWith(
      'api/v1/device/piano-tablet/screen/suppress-wake',
      { minutes: 20 },
      'POST',
    );
    expect(h.setCurrentUser).toHaveBeenCalledWith('guest');
  });

  it('skips the suppress-wake call when no deviceId is configured', async () => {
    h.config = { screensaver: { offCooldownMinutes: 20 } };
    const { result } = renderHook(() => usePianoScreenOff());
    await act(async () => { await result.current(); });

    expect(h.turnOffScreen).toHaveBeenCalledTimes(1);
    expect(h.beginScreenOffCooldown).toHaveBeenCalledTimes(1);
    expect(h.DaylightAPI).not.toHaveBeenCalled();
    expect(h.setCurrentUser).toHaveBeenCalledWith('guest');
  });

  it('defaults the cooldown to 30 minutes when unset', async () => {
    h.config = { screensaver: { deviceId: 'piano-tablet' } };
    const { result } = renderHook(() => usePianoScreenOff());
    await act(async () => { await result.current(); });

    expect(h.DaylightAPI).toHaveBeenCalledWith(
      'api/v1/device/piano-tablet/screen/suppress-wake',
      { minutes: 30 },
      'POST',
    );
  });
});
