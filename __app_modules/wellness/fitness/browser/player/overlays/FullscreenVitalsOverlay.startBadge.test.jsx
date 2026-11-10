import React from 'react';
import { render } from '@testing-library/react';

const governed = {
  isGoverned: true,
  challenge: null,
  unattendedStart: {
    zone: 'hot', zoneLabel: 'Hot',
    children: { 'child-a': { started: false, overdue: false, remainingMs: 60_000 } },
  },
};

vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => ({
    heartRateDevices: [{ deviceId: 'd1', heartRate: 120, connectionState: 'connected' }],
    rpmDevices: [],
    getUserByDevice: () => ({ id: 'child-a', name: 'Child A' }),
    users: [{ id: 'child-a', name: 'Child A' }],
    userCurrentZones: {},
    zones: [{ id: 'warm', color: '#facc15', min: 120 }],
    usersConfigRaw: {},
    equipment: [],
    deviceConfiguration: {},
    userZoneProgress: null,
    governanceState: governed,
  })
}));

import FullscreenVitalsOverlay from "./FullscreenVitalsOverlay.jsx";

describe('FullscreenVitalsOverlay start badge', () => {
  it('shows "Reach Hot" for a not-started child from context', () => {
    const { container } = render(<FullscreenVitalsOverlay visible />);
    expect(container.querySelector('.governance-start-badge')?.textContent).toBe('Reach Hot');
  });

  it('shows no badge when the player passes a bypassed (ungoverned) snapshot', () => {
    const bypassed = { ...governed, isGoverned: false, challenge: null };
    const { container } = render(<FullscreenVitalsOverlay visible governanceStateOverride={bypassed} />);
    expect(container.querySelector('.governance-start-badge')).toBeNull();
  });
});
