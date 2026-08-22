// frontend/src/modules/Media/shell/PrimaryNav.test.jsx
// The Devices tab carries a badge of actively-playing device count — this
// replaces the dock's FleetIndicator ("Devices 2/5") as the fleet
// at-a-glance signal now that the indicator is desktop-only (Task 13:
// mobile's dock is a launcher, no room for it there).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const pushMock = vi.fn();
vi.mock('./NavProvider.jsx', () => ({
  useNav: () => ({ view: 'home', push: pushMock }),
}));

let fleetSummary = { active: 0, total: 0 };
vi.mock('../fleet/useFleetSummary.js', () => ({
  useFleetSummary: () => fleetSummary,
}));

import { NavRail, TabBar } from './PrimaryNav.jsx';

function renderWithMantine(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  fleetSummary = { active: 0, total: 0 };
});

describe('PrimaryNav', () => {
  it('shows no badge on the Devices tab when nothing is active', () => {
    renderWithMantine(<TabBar />);
    expect(screen.queryByTestId('app-tab-fleet-badge')).not.toBeInTheDocument();
  });

  it('shows the active device count as a badge on the Devices tab', () => {
    fleetSummary = { active: 2, total: 5 };
    renderWithMantine(<TabBar />);
    expect(screen.getByTestId('app-tab-fleet-badge')).toHaveTextContent('2');
  });

  it('does not badge Home or Browse', () => {
    fleetSummary = { active: 3, total: 5 };
    renderWithMantine(<TabBar />);
    expect(screen.queryByTestId('app-tab-home-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-tab-browse-badge')).not.toBeInTheDocument();
  });

  it('renders the same badge on the nav rail (tablet+)', () => {
    fleetSummary = { active: 1, total: 3 };
    renderWithMantine(<NavRail />);
    expect(screen.getByTestId('app-nav-fleet-badge')).toHaveTextContent('1');
  });
});
