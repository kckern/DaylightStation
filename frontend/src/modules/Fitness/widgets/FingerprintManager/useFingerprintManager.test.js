// frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '@/lib/api.mjs';
import { useFingerprintManager } from './useFingerprintManager.js';

beforeEach(() => { DaylightAPI.mockReset(); });

describe('useFingerprintManager', () => {
  it('loads the user list on refresh', async () => {
    DaylightAPI.mockResolvedValueOnce([{ username: 'test-user', admin: false, fingerprints: [] }]);
    const { result } = renderHook(() => useFingerprintManager());
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.users).toHaveLength(1));
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/fingerprints');
  });

  it('enroll posts username/finger/clientToken', async () => {
    DaylightAPI.mockResolvedValueOnce({ success: true, finger: 'right-index' });
    const { result } = renderHook(() => useFingerprintManager());
    let resp;
    await act(async () => { resp = await result.current.enroll({ username: 'test-user', finger: 'right-index', clientToken: 'tok' }); });
    expect(resp).toMatchObject({ success: true });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/fingerprints/enroll', { username: 'test-user', finger: 'right-index', clientToken: 'tok' }, 'POST');
  });

  it('remove issues a DELETE keyed by finger name', async () => {
    DaylightAPI.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useFingerprintManager());
    await act(async () => { await result.current.remove({ username: 'test-user', finger: 'right-index' }); });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/fingerprints', { username: 'test-user', finger: 'right-index' }, 'DELETE');
  });
});
