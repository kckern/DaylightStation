import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../api.mjs';
import { useDeviceConfig } from './useDeviceConfig.js';

vi.mock('../api.mjs', () => ({ DaylightAPI: vi.fn() }));

describe('useDeviceConfig', () => {
  it('shares a pending roster across consumers with independent recovery policies', async () => {
    const request = Promise.withResolvers();
    DaylightAPI.mockReturnValueOnce(request.promise);
    const fleet = renderHook(() => useDeviceConfig({ retryTransient: false, clearDataOnError: true }));
    const labels = renderHook(() => useDeviceConfig());
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));
    const [path, , method, { signal }] = DaylightAPI.mock.calls[0];
    expect(path).toBe('api/v1/device/config');
    expect(method).toBe('GET');

    fleet.unmount();
    await act(async () => request.resolve({ devices: { lounge: { name: 'Lounge screen' } } }));
    expect(signal.aborted).toBe(false);
    expect(labels.result.current.devices).toEqual({ lounge: { name: 'Lounge screen' } });
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
  });
});
