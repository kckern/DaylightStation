// frontend/src/modules/Media/shell/Dock.test.jsx
// On mobile the dock is reduced to a launcher: tapping it opens the
// full-screen Search Mode surface (SearchMode.jsx, Task 13) instead of
// fighting for space in the dock row. This suite covers Dock's side of that
// wiring — the launcher button calling the `onOpenSearch` prop the shell
// passes in — not SearchMode itself (see SearchMode.test.jsx).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

vi.mock('../search/MediaContentSearch.jsx', () => ({
  MediaContentSearch: () => <div data-testid="media-content-search-stub" />,
}));
vi.mock('./FleetIndicator.jsx', () => ({
  FleetIndicator: () => <div data-testid="fleet-indicator-stub" />,
}));
vi.mock('../cast/CastTargetChip.jsx', () => ({
  CastTargetChip: () => <div data-testid="cast-target-chip-stub" />,
}));
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ lifecycle: { reset: vi.fn() } }),
}));

import { Dock } from './Dock.jsx';

function renderDock(props = {}) {
  return render(
    <MantineProvider>
      <Dock {...props} />
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Dock', () => {
  it('tapping the search launcher calls onOpenSearch', () => {
    const onOpenSearch = vi.fn();
    renderDock({ onOpenSearch });

    fireEvent.click(screen.getByTestId('media-search-launcher'));

    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('the launcher reads "Search media…"', () => {
    renderDock({ onOpenSearch: vi.fn() });
    expect(screen.getByTestId('media-search-launcher')).toHaveTextContent('Search media…');
  });

  it('still renders the settings gear and the persistent desktop search/cluster', () => {
    renderDock({ onOpenSearch: vi.fn() });
    expect(screen.getByTestId('settings-menu-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('media-content-search-stub')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-indicator-stub')).toBeInTheDocument();
    expect(screen.getByTestId('cast-target-chip-stub')).toBeInTheDocument();
  });

  it('does not blow up when onOpenSearch is omitted', () => {
    renderDock();
    expect(() => fireEvent.click(screen.getByTestId('media-search-launcher'))).not.toThrow();
  });
});
