import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useDevices } from './useDevices.js';

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
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.devices).toHaveLength(2));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('captures error and exposes empty device list', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.devices).toEqual([]);
  });
});
