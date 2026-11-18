import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => log }),
}));

import { useJankRebootPrompt } from './useJankRebootPrompt.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete global.fully;
  delete global.daylight;
  Object.values(log).forEach(fn => fn.mockClear());
});

const readStatus = async () => ({ nativeRecoveryAllowed: true, bootCount: 1, deviceId: "test-device" });
const reboot = async () => {
  const { result, unmount } = renderHook(() => useJankRebootPrompt({ readStatus }));
  await act(async () => { await result.current.onReboot(); });
  unmount();
};

describe('useJankRebootPrompt reboot action', () => {
  it('reboots through the Fully bridge', async () => {
    global.fully = { turnScreenOff: vi.fn(), reboot: vi.fn() };
    await reboot();
    expect(global.fully.reboot).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('reboots through the daylight bridge when the page runs in the Android kiosk app', async () => {
    global.daylight = { reboot: vi.fn(() => true), screen: vi.fn() };
    await reboot();
    expect(global.daylight.reboot).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('prefers an injected reboot action', async () => {
    global.fully = { turnScreenOff: vi.fn(), reboot: vi.fn() };
    const injected = vi.fn();
    const { result } = renderHook(() => useJankRebootPrompt({ readStatus, reboot: injected }));
    await act(async () => { await result.current.onReboot(); });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(global.fully.reboot).not.toHaveBeenCalled();
  });

  it('logs reboot-failed, as it always did, when fully.reboot throws', async () => {
    global.fully = { turnScreenOff: vi.fn(), reboot: vi.fn(() => { throw new Error('no device admin'); }) };
    await reboot();
    expect(log.error).toHaveBeenCalledWith('piano.jank-reboot.reboot-failed', { error: 'no device admin' });
    expect(log.error).not.toHaveBeenCalledWith('piano.jank-reboot.no-fully', expect.anything());
  });

  it('logs reboot-failed when an injected reboot action throws', async () => {
    const { result } = renderHook(() => useJankRebootPrompt({ readStatus, reboot: () => { throw new Error('injected'); } }));
    await act(async () => { await result.current.onReboot(); });
    expect(log.error).toHaveBeenCalledWith('piano.jank-reboot.reboot-failed', { error: 'injected' });
  });

  it('logs no-fully when the bridge is there and has no reboot', async () => {
    global.fully = { turnScreenOff: vi.fn() };
    await reboot();
    expect(log.error).toHaveBeenCalledWith('piano.jank-reboot.no-fully', {});
  });

  it('logs that it cannot reboot when no bridge can', async () => {
    await reboot();
    expect(log.error).toHaveBeenCalledWith('piano.jank-reboot.no-fully', {});
  });
});
