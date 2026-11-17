import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => log }),
}));

import { useJankRebootPrompt } from './useJankRebootPrompt.js';

afterEach(() => {
  delete global.fully;
  delete global.daylight;
  Object.values(log).forEach(fn => fn.mockClear());
});

const reboot = () => {
  const { result, unmount } = renderHook(() => useJankRebootPrompt());
  act(() => result.current.onReboot());
  unmount();
};

describe('useJankRebootPrompt reboot action', () => {
  it('reboots through the Fully bridge', () => {
    global.fully = { turnScreenOff: vi.fn(), reboot: vi.fn() };
    reboot();
    expect(global.fully.reboot).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('reboots through the daylight bridge when the page runs in the Android kiosk app', () => {
    global.daylight = { reboot: vi.fn(() => true), screen: vi.fn() };
    reboot();
    expect(global.daylight.reboot).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('prefers an injected reboot action', () => {
    global.fully = { turnScreenOff: vi.fn(), reboot: vi.fn() };
    const injected = vi.fn();
    const { result } = renderHook(() => useJankRebootPrompt({ reboot: injected }));
    act(() => result.current.onReboot());
    expect(injected).toHaveBeenCalledTimes(1);
    expect(global.fully.reboot).not.toHaveBeenCalled();
  });

  it('logs reboot-failed, as it always did, when fully.reboot throws', () => {
    global.fully = { turnScreenOff: vi.fn(), reboot: vi.fn(() => { throw new Error('no device admin'); }) };
    reboot();
    expect(log.error).toHaveBeenCalledWith('piano.jank-reboot.reboot-failed', { error: 'no device admin' });
    expect(log.error).not.toHaveBeenCalledWith('piano.jank-reboot.no-fully', expect.anything());
  });

  it('logs reboot-failed when an injected reboot action throws', () => {
    const { result } = renderHook(() => useJankRebootPrompt({ reboot: () => { throw new Error('injected'); } }));
    act(() => result.current.onReboot());
    expect(log.error).toHaveBeenCalledWith('piano.jank-reboot.reboot-failed', { error: 'injected' });
  });

  it('logs no-fully when the bridge is there and has no reboot', () => {
    global.fully = { turnScreenOff: vi.fn() };
    reboot();
    expect(log.error).toHaveBeenCalledWith('piano.jank-reboot.no-fully', {});
  });

  it('logs that it cannot reboot when no bridge can', () => {
    reboot();
    expect(log.error).toHaveBeenCalledWith('piano.jank-reboot.no-fully', {});
  });
});
