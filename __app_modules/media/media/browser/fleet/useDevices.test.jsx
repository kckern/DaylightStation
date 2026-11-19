import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useDevices } from "./useDevices.js";

beforeEach(() => { apiMock.mockReset(); });

describe('useDevices', () => {
  it('fetches /api/v1/device/config on mount', async () => {
    apiMock.mockResolvedValueOnce({
      devices: {
        'livingroom-tv': { type: 'shield-tv', content_control: { provider: 'fully-kiosk' } },
        'office-tv': { type: 'linux-pc', content_control: { provider: 'x' } },
      },
    });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).toHaveBeenCalledWith('api/v1/device/config');
    expect(result.current.devices.map((d) => d.id)).toEqual(['livingroom-tv', 'office-tv']);
    expect(result.current.error).toBeNull();
  });

  it('filters out devices without content_control (cameras, piano, scanner)', async () => {
    apiMock.mockResolvedValueOnce({
      devices: {
        'livingroom-tv': { type: 'shield-tv', content_control: { provider: 'x' } },
        'piano': { type: 'midi-keyboard' },
        'camera-1': { type: 'ip-camera' },
      },
    });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices.map((d) => d.id)).toEqual(['livingroom-tv']);
  });

  it('includes fleet: true devices even without content_control (speakers)', async () => {
    apiMock.mockResolvedValueOnce({
      devices: {
        'livingroom-tv': { type: 'shield-tv', content_control: { provider: 'x' } },
        'speaker-red': { type: 'speaker', fleet: true, name: 'Red musiCozy' },
        'speaker-white': { type: 'speaker', fleet: true },
        'piano': { type: 'midi-keyboard' },
        'not-fleet': { type: 'speaker', fleet: false },
        'truthy-but-not-true': { type: 'speaker', fleet: 'yes' },
      },
    });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices.map((d) => d.id)).toEqual([
      'livingroom-tv', 'speaker-red', 'speaker-white',
    ]);
    expect(result.current.devices[1]).toMatchObject({
      id: 'speaker-red', type: 'speaker', name: 'Red musiCozy', fleet: true,
    });
  });

  it('each device entry exposes {id, type, name, ...config}', async () => {
    apiMock.mockResolvedValueOnce({
      devices: { 'lr': { type: 'shield-tv', name: 'Living Room', content_control: { x: 1 } } },
    });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices[0]).toMatchObject({ id: 'lr', type: 'shield-tv', name: 'Living Room' });
  });

  it('refresh() re-fetches', async () => {
    apiMock
      .mockResolvedValueOnce({ devices: { 'a': { type: 'shield-tv', content_control: {} } } })
      .mockResolvedValueOnce({ devices: { 'a': { type: 'shield-tv', content_control: {} }, 'b': { type: 'linux-pc', content_control: {} } } });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    await act(async () => { await refreshed; });
    await waitFor(() => expect(result.current.devices).toHaveLength(2));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('ignores an older failure after reconnect loads a fresh roster', async () => {
    let failFirst;
    apiMock.mockReturnValueOnce(new Promise((_, reject) => { failFirst = reject; }))
      .mockResolvedValueOnce({ devices: { screen: { fleet: true } } });
    const { result } = renderHook(() => useDevices());
    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    await act(async () => { await refreshed; });
    await act(async () => { failFirst(new Error('offline')); });
    expect(result.current.devices.map(device => device.id)).toEqual(['screen']);
    expect(result.current.error).toBeNull();
  });

  it('captures error and exposes empty device list', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.devices).toEqual([]);
  });

  it('settles a failed refresh and keeps its roster empty until recovery succeeds', async () => {
    let recover;
    apiMock.mockResolvedValueOnce({ devices: { screen: { fleet: true } } })
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise(resolve => { recover = resolve; }));
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    await act(async () => { await refreshed; });
    expect(result.current.error?.message).toBe('offline');
    expect(result.current.devices).toEqual([]);

    act(() => { refreshed = result.current.refresh(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.devices).toEqual([]);
    await act(async () => {
      recover({ devices: { replacement: { fleet: true } } });
      await refreshed;
    });
    expect(result.current.devices.map(device => device.id)).toEqual(['replacement']);
  });
});
