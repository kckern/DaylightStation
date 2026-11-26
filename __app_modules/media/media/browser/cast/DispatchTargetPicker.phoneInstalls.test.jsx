// Play on with two phones (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §H,
// audit item 6): two live installs of the phone are two rows by model, and a play from
// either names its install; one live install stays one "Phone" row.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { FleetContext } from "../fleet/FleetProvider.jsx";

const dispatchToTarget = vi.fn(async () => ['d1']);
vi.mock("./useDispatch.js", () => ({ useDispatch: () => ({ dispatchToTarget }) }));
const phone = { id: 'phone', name: 'Phone', type: 'phone', content_control: { provider: 'phone-inbox' } };
const fleetDevices = [phone, { id: 'office-tv', name: 'Office TV' }];
vi.mock("../fleet/useDevice.js", () => ({
  useDevice: (id) => ({ device: fleetDevices.find((d) => d.id === id) ?? null, entry: null }),
}));
vi.mock("./useCastTarget.js", () => ({ useCastTarget: () => ({ targetIds: [], mode: 'fork' }) }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: vi.fn() }));
let views = {};
const watch = vi.fn(() => () => {});
vi.mock("./usePhoneKeeps.jsx", () => ({
  usePhoneKeeps: () => ({ views, watch }),
  useWatchPhoneKeeps: () => {},
}));

import { DispatchTargetPicker } from "./DispatchTargetPicker.jsx";

const A = 'install-aaaa-1111';
const B = 'install-bbbb-2222';
const withFleet = (ui) => render(
  <MantineProvider>
    <FleetContext.Provider value={{ devices: fleetDevices, store: { getEntry: () => null }, registry: { screens: [], roomAdjacency: {} }, identity: null }}>{ui}</FleetContext.Provider>
  </MantineProvider>,
);
const song = { play: 'plex:1', title: 'A song', item: { id: 'plex:1', type: 'track', mediaType: 'audio' } };

describe('Play on: the phone by install', () => {
  beforeEach(() => { dispatchToTarget.mockClear(); });

  it('one live install: one "Phone" row, and the play names no install', () => {
    views = { phone: { installs: [{ installId: A, model: 'SM-S921U', current: true, live: true }] } };
    withFleet(<DispatchTargetPicker source={song} verb="Play" />);
    expect(screen.getByTestId('picker-device-phone')).toHaveTextContent('Phone');
    expect(screen.queryByTestId(`picker-device-phone#${A}`)).toBeNull();
    fireEvent.click(screen.getByTestId('picker-device-phone'));
    expect(dispatchToTarget).toHaveBeenCalledWith(expect.objectContaining({ targetIds: ['phone'] }));
  });

  it('two live installs: one row each by model, and a play from either names its install', () => {
    views = { phone: { installs: [
      { installId: A, model: 'SM-S921U', current: true, live: true },
      { installId: B, model: 'sdk_gphone64', live: true },
    ] } };
    withFleet(<DispatchTargetPicker source={song} verb="Play" />);
    expect(screen.queryByTestId('picker-device-phone')).toBeNull();
    expect(screen.getByTestId(`picker-device-phone#${A}`)).toHaveTextContent('Phone · SM-S921U');
    expect(screen.getByTestId(`picker-device-phone#${B}`)).toHaveTextContent('Phone · sdk_gphone64');
    fireEvent.click(screen.getByTestId(`picker-device-phone#${B}`));
    expect(dispatchToTarget).toHaveBeenCalledWith(expect.objectContaining({ targetIds: [`phone#${B}`] }));
  });

  it('a gone or not-live install is never a row', () => {
    views = { phone: { installs: [
      { installId: A, model: 'SM-S921U', current: true, live: true },
      { installId: B, model: 'old phone', live: false, gone: true },
    ] } };
    withFleet(<DispatchTargetPicker source={song} verb="Play" />);
    expect(screen.getByTestId('picker-device-phone')).toBeTruthy();
    expect(screen.queryByTestId(`picker-device-phone#${B}`)).toBeNull();
  });
});
