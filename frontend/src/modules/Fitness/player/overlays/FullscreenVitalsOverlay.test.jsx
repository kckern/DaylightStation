import React from 'react';
import { render } from '@testing-library/react';

// NOTE: the user's id ('felix') and display name ('Felix') are DISTINCT on purpose.
// boostContributions is keyed by the governance participant id (slug), so the tile
// must look up by user.id, not user.name. A name-keyed lookup would miss here and
// the badge would silently never render — this mock guards that keying.
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({
    heartRateDevices: [{ deviceId: 'd1', heartRate: 150, connectionState: 'connected' }],
    rpmDevices: [],
    getUserByDevice: () => ({ id: 'felix', name: 'Felix' }),
    users: [{ id: 'felix', name: 'Felix' }],
    userCurrentZones: { Felix: { id: 'fire', color: '#ef4444' } },
    zones: [{ id: 'fire', color: '#ef4444', min: 170 }],
    usersConfigRaw: {},
    equipment: [],
    deviceConfiguration: {},
    userZoneProgress: null,
    governanceState: {
      challenge: { type: 'cycle', boostContributions: { felix: 0.5 } }
    }
  })
}));

import FullscreenVitalsOverlay from './FullscreenVitalsOverlay.jsx';

describe('FullscreenVitalsOverlay cycle boost badges', () => {
  it('shows a per-tile boost badge keyed by user id (not display name)', () => {
    const { container } = render(<FullscreenVitalsOverlay visible />);
    const badge = container.querySelector('.vital-boost-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('×1.5'); // 1.0 + 0.5
  });

  it('renders exactly one badge for the single contributing user', () => {
    const { container } = render(<FullscreenVitalsOverlay visible />);
    expect(container.querySelectorAll('.vital-boost-badge')).toHaveLength(1);
  });
});
