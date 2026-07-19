import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKioskLaunchTargets } from './useKioskLaunchTargets.js';

const GAMES_CONFIG = {
  targets: [
    { deviceId: 'yellow-room-tablet', allow: ['retroarch:gb/super-mario-land', 'retroarch:gb/pokemon-yellow'] }
  ]
};

const DEVICE_CONFIG = { devices: { 'yellow-room-tablet': { name: 'Piano Tablet' } } };

const mockFetch = (routes) => {
  global.fetch = vi.fn((url) => {
    const entry = Object.entries(routes).find(([key]) => url.includes(key));
    if (!entry) return Promise.resolve({ ok: false, status: 404 });
    const [, value] = entry;
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
  });
};

describe('useKioskLaunchTargets', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('reads targets and allowlists from games.yml', async () => {
    mockFetch({ 'launch-targets': GAMES_CONFIG, 'device/config': DEVICE_CONFIG });
    const { result } = renderHook(() => useKioskLaunchTargets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.targets).toEqual([{
      deviceId: 'yellow-room-tablet',
      label: 'Piano Tablet',
      allow: ['retroarch:gb/super-mario-land', 'retroarch:gb/pokemon-yellow']
    }]);
  });

  it('falls back to the device id when the registry has no name', async () => {
    mockFetch({ 'launch-targets': GAMES_CONFIG, 'device/config': { devices: {} } });
    const { result } = renderHook(() => useKioskLaunchTargets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.targets[0].label).toBe('yellow-room-tablet');
  });

  it('keeps the targets when the device registry fetch fails', async () => {
    // Labels are cosmetic; losing them must not cost us the ability to launch.
    mockFetch({ 'launch-targets': GAMES_CONFIG, 'device/config': new Error('offline') });
    const { result } = renderHook(() => useKioskLaunchTargets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.targets).toHaveLength(1);
    expect(result.current.targets[0].label).toBe('yellow-room-tablet');
  });

  it('yields no targets when no device_targets are configured', async () => {
    // Absent config must offer nothing rather than guessing what is safe to launch.
    mockFetch({ 'launch-targets': { targets: [] }, 'device/config': DEVICE_CONFIG });
    const { result } = renderHook(() => useKioskLaunchTargets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.targets).toEqual([]);
  });

  it('treats a target with no allow list as allowing nothing', async () => {
    mockFetch({
      'launch-targets': { targets: [{ deviceId: 'yellow-room-tablet' }] },
      'device/config': DEVICE_CONFIG
    });
    const { result } = renderHook(() => useKioskLaunchTargets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.targets[0].allow).toEqual([]);
  });

  it('reports an error when the launch-targets endpoint cannot be read', async () => {
    mockFetch({ 'device/config': DEVICE_CONFIG });
    const { result } = renderHook(() => useKioskLaunchTargets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.targets).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });
});
