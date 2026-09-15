import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const DaylightAPI = vi.fn();
const receiveClaim = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => DaylightAPI(...args) }));
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ controller: null, portability: { receiveClaim } }),
}));
vi.mock('../logging/mediaLog.js', () => ({ default: new Proxy({}, { get: () => vi.fn() }) }));

import { useTakeOver } from './useTakeOver.js';

describe('useTakeOver M0 destructive-transfer guard', () => {
  it('returns an explicit unsupported failure without claiming, stopping, or adopting a remote session', async () => {
    const { result } = renderHook(() => useTakeOver());

    let outcome;
    await act(async () => { outcome = await result.current('livingroom-tv'); });

    expect(outcome).toEqual({ ok: false, error: 'move-unsupported' });
    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(receiveClaim).not.toHaveBeenCalled();
  });
});
