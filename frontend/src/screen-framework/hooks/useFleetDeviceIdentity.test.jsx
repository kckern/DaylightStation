// The screen is the only place in the frontend that knows which fleet device
// it is (wsConfig.guardrails.device, from its served config). Until it says so,
// every request it makes is signed `browser:<token>` — anonymous — and the
// backend cannot tell the living-room TV from a laptop tab. On 2026-09-08 that
// is exactly why no TV ever joined a Home Line call: join-active wants the
// TV's fleet name and the Shield declared a browser token.
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFleetDeviceIdentity } from './useFleetDeviceIdentity.js';
import { getDeviceId, _resetDeviceIdForTests } from '../../lib/deviceIdentity.js';

describe('useFleetDeviceIdentity', () => {
  afterEach(() => { delete window.__DAYLIGHT_DEVICE_ID; _resetDeviceIdForTests(); });

  it('signs every request from a rendered screen with its fleet name', () => {
    renderHook(() => useFleetDeviceIdentity('livingroom-tv'));
    expect(getDeviceId()).toBe('fleet:livingroom-tv');
  });

  it('follows the screen when its config changes', () => {
    const { rerender } = renderHook(({ id }) => useFleetDeviceIdentity(id), { initialProps: { id: 'livingroom-tv' } });
    rerender({ id: 'office-tv' });
    expect(getDeviceId()).toBe('fleet:office-tv');
  });

  it('says nothing for a screen with no fleet name, and drops the claim on unmount', () => {
    const { unmount } = renderHook(() => useFleetDeviceIdentity(undefined));
    expect(getDeviceId()).toMatch(/^browser:/);
    unmount();
    const mounted = renderHook(() => useFleetDeviceIdentity('livingroom-tv'));
    mounted.unmount();
    _resetDeviceIdForTests();
    expect(getDeviceId()).toMatch(/^browser:/);
  });
});
