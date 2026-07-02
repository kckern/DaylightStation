import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: vi.fn() }));

import { DaylightAPI } from '../../../lib/api.mjs';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { useScreenControl } from './useScreenControl.js';

function setConfig(deviceId) {
  usePianoKioskConfig.mockReturnValue({ config: { screensaver: { deviceId } } });
}

describe('useScreenControl.turnOffScreen', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
    usePianoKioskConfig.mockReset();
  });
  afterEach(() => { delete global.fully; });

  it('uses the FKB bridge and makes no API call when the bridge is present', async () => {
    const turnScreenOff = vi.fn();
    global.fully = { turnScreenOff };
    setConfig('piano-tablet');
    const { result } = renderHook(() => useScreenControl());

    let out;
    await act(async () => { out = await result.current.turnOffScreen(); });

    expect(turnScreenOff).toHaveBeenCalledTimes(1);
    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, lever: 'fkb' });
  });

  it('falls back to the backend API when the bridge is unavailable', async () => {
    setConfig('piano-tablet');
    DaylightAPI.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useScreenControl());

    let out;
    await act(async () => { out = await result.current.turnOffScreen(); });

    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/device/piano-tablet/screen/off');
    expect(out).toEqual({ ok: true, lever: 'api' });
  });

  it('bridge works even when deviceId is null (the robustness point)', async () => {
    const turnScreenOff = vi.fn();
    global.fully = { turnScreenOff };
    setConfig(null);
    const { result } = renderHook(() => useScreenControl());

    let out;
    await act(async () => { out = await result.current.turnOffScreen(); });

    expect(turnScreenOff).toHaveBeenCalledTimes(1);
    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
  });

  it('returns the no-path status when neither bridge nor deviceId is available', async () => {
    setConfig(null);
    const { result } = renderHook(() => useScreenControl());

    let out;
    await act(async () => { out = await result.current.turnOffScreen(); });

    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, lever: 'none', error: 'no screen-control path' });
  });

  it('reports a rejected backend response', async () => {
    setConfig('piano-tablet');
    DaylightAPI.mockResolvedValue({ ok: false, error: 'device offline' });
    const { result } = renderHook(() => useScreenControl());

    let out;
    await act(async () => { out = await result.current.turnOffScreen(); });

    expect(out).toEqual({ ok: false, lever: 'api', error: 'device offline' });
  });
});
