import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

const fkb = vi.hoisted(() => ({
  isFKBAvailable: vi.fn(() => true),
  launchApp: vi.fn(() => true),
  launchAndroidTarget: vi.fn(() => true),
  onResume: vi.fn(),
}));
const api = vi.hoisted(() => ({
  DaylightAPI: vi.fn(async () => ({ ok: true, guarded: true })),
  DaylightMediaPath: (p) => p,
}));
vi.mock('../../lib/fkb.js', () => fkb);
vi.mock('../../lib/api.mjs', () => api);

import AndroidLaunchCard from './AndroidLaunchCard.jsx';

const PAIRING = { package: 'com.android.tv.settings', activity: '.accessories.AddAccessoryActivity' };

async function mount(android) {
  let utils;
  await act(async () => { utils = render(<AndroidLaunchCard android={android} title="App" onClose={() => {}} />); });
  return utils;
}

describe('AndroidLaunchCard', () => {
  beforeEach(() => { window.__DAYLIGHT_DEVICE_ID = 'livingroom-tv'; });
  afterEach(() => { cleanup(); vi.clearAllMocks(); delete window.__DAYLIGHT_DEVICE_ID; });

  it('opens the exact screen an entry names, through the kiosk component launch', async () => {
    await mount(PAIRING);
    expect(fkb.launchAndroidTarget).toHaveBeenCalledWith(PAIRING);
    expect(fkb.launchApp).not.toHaveBeenCalled();
  });

  it('opens the app front door when the entry names only a package', async () => {
    await mount({ package: 'us.zoom.videomeetings', activity: '' });
    expect(fkb.launchApp).toHaveBeenCalledWith('us.zoom.videomeetings');
    expect(fkb.launchAndroidTarget).not.toHaveBeenCalled();
  });

  it('announces the excursion to the backend before leaving the page', async () => {
    const order = [];
    api.DaylightAPI.mockImplementationOnce(async () => { order.push('announce'); return { guarded: true }; });
    fkb.launchAndroidTarget.mockImplementationOnce(() => { order.push('launch'); return true; });
    await mount(PAIRING);
    expect(api.DaylightAPI).toHaveBeenCalledWith('api/v1/device/livingroom-tv/excursion', PAIRING, 'POST');
    expect(order).toEqual(['announce', 'launch']);
  });

  it('still launches when the backend cannot be reached', async () => {
    api.DaylightAPI.mockRejectedValueOnce(new Error('offline'));
    await mount(PAIRING);
    expect(fkb.launchAndroidTarget).toHaveBeenCalledTimes(1);
  });

  it('does not launch if the card closed while the notice was in flight', async () => {
    let release;
    api.DaylightAPI.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const { unmount } = render(<AndroidLaunchCard android={PAIRING} title="App" onClose={() => {}} />);
    unmount();
    await act(async () => { release({ guarded: true }); });
    expect(fkb.launchAndroidTarget).not.toHaveBeenCalled();
  });
});
