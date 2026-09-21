// frontend/src/modules/Media/shell/PrimaryNav.test.jsx
// Primary Devices navigation must remain navigation, not a second fleet
// summary. The shared HouseIndicator is the one visible playback count.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const goToAreaMock = vi.fn();
let navState = { view: 'home', area: 'home' };
vi.mock('./NavProvider.jsx', () => ({
  useNav: () => ({ ...navState, goToArea: goToAreaMock }),
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
  navState = { view: 'home', area: 'home' };
  fleetSummary = { active: 0, total: 0 };
});

describe('PrimaryNav', () => {
  it('does not duplicate the shared house summary on the Devices tab', () => {
    fleetSummary = { active: 2, total: 5 };
    renderWithMantine(<TabBar />);
    expect(screen.queryByTestId('app-tab-fleet-badge')).not.toBeInTheDocument();
  });

  it('does not expose count badges from the rail either', () => {
    fleetSummary = { active: 3, total: 5 };
    renderWithMantine(<NavRail />);
    expect(screen.queryByTestId('app-nav-fleet-badge')).not.toBeInTheDocument();
  });

  it.each([
    ['nowPlaying', 'home', 'app-tab-home', 'app-nav-home'],
    ['detail', 'browse', 'app-tab-browse', 'app-nav-browse'],
    ['peek', 'fleet', 'app-tab-fleet', 'app-nav-fleet'],
  ])('keeps %s owned by %s on both primary controls', (view, area, tabSelector, railSelector) => {
    navState = { view, area };
    renderWithMantine(<TabBar />);
    expect(screen.getByTestId(tabSelector)).toHaveAttribute('aria-current', 'page');
    renderWithMantine(<NavRail />);
    expect(screen.getByTestId(railSelector)).toHaveAttribute('aria-current', 'page');
  });

  it('uses goToArea for primary selection on the tablet rail', () => {
    renderWithMantine(<NavRail />);
    fireEvent.click(screen.getByTestId('app-nav-browse'));
    expect(goToAreaMock).toHaveBeenCalledWith('browse');
  });
});
