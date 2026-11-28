// frontend/src/modules/Media/shell/Dock.test.jsx
// On mobile the dock is reduced to a launcher: tapping it opens the
// full-screen Search Mode surface (SearchMode.jsx, Task 13) instead of
// fighting for space in the dock row. This suite covers Dock's side of that
// wiring — the launcher button calling the `onOpenSearch` prop the shell
// passes in — not SearchMode itself (see SearchMode.test.jsx).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CastTargetProvider, CAST_TARGET_KEY } from "../cast/CastTargetProvider.jsx";
import { useCastTarget } from "../cast/useCastTarget.js";

const { lifecycleReset } = vi.hoisted(() => ({ lifecycleReset: vi.fn() }));

// Settings leads to screen admin / routine history through the nav stack.
vi.mock("./NavProvider.jsx", () => ({ useNav: () => ({ push: () => {} }) }));
vi.mock("../search/MediaContentSearch.jsx", () => ({
  MediaContentSearch: ({ destinationWrapper: Wrapper }) => (
    <div data-testid="media-content-search-stub" data-first-use={Wrapper ? 'chip' : 'none'} />
  ),
}));
const { compact } = vi.hoisted(() => ({ compact: { value: false } }));
vi.mock('@/lib/ui/useCompactViewport.js', () => ({ useCompactViewport: () => compact.value }));
vi.mock("./FleetIndicator.jsx", () => ({
  FleetIndicator: () => <div data-testid="fleet-indicator-stub" />,
}));
vi.mock("../search/DestinationChip.jsx", () => ({
  DestinationChip: ({ compact }) => <div data-testid="destination-chip-stub" data-compact={compact ? 'yes' : 'no'} />,
}));
vi.mock("../controller/useSessionController.js", () => ({
  useSessionController: () => ({ lifecycle: { reset: lifecycleReset } }),
}));
vi.mock("../identity/useClientIdentity.js", () => ({
  useClientIdentity: () => ({ name: 'Browser test', deviceId: 'browser:test', rename: vi.fn() }),
}));
vi.mock("../fleet/useFleetContext.js", () => ({
  useFleetContext: () => ({ devices: [] }),
}));

import { Dock } from "./Dock.jsx";

function AimProbe() {
  const { targetIds } = useCastTarget();
  return <span data-testid="aim-probe">{targetIds.join(',') || 'This device'}</span>;
}

function renderDock(props = {}) {
  return render(
    <MantineProvider>
      <CastTargetProvider>
        <Dock {...props} />
        <AimProbe />
      </CastTargetProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  compact.value = false;
  vi.clearAllMocks();
  localStorage.clear();
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
  });

  it('desktop: no header "Playing on" control — the destination lives in the search box, first-use hint on its chip', () => {
    compact.value = false;
    renderDock({ onOpenSearch: vi.fn() });
    expect(screen.queryByTestId('destination-chip-stub')).toBeNull();
    expect(screen.getByTestId('media-content-search-stub')).toHaveAttribute('data-first-use', 'chip');
  });

  it('phone: no header "Playing on" control — the same chip rides the search launcher, first-use hint on it', () => {
    compact.value = true;
    renderDock({ onOpenSearch: vi.fn() });
    const row = screen.getByTestId('media-search-launcher-row');
    expect(within(row).getByTestId('media-search-launcher')).toHaveTextContent('Search media…');
    expect(within(row).getByTestId('destination-chip-stub')).toHaveAttribute('data-compact', 'yes');
    expect(screen.queryByText('Playing on')).toBeNull();
    expect(screen.getByTestId('media-content-search-stub')).toHaveAttribute('data-first-use', 'none');
  });

  it('does not blow up when onOpenSearch is omitted', () => {
    renderDock();
    expect(() => fireEvent.click(screen.getByTestId('media-search-launcher'))).not.toThrow();
  });

  it('Start fresh defaults to returning the shared aim to This device', async () => {
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({
      mode: 'transfer', targetIds: ['office'], activityAt: Date.now(),
    }));
    renderDock();

    expect(screen.getByTestId('aim-probe')).toHaveTextContent('office');
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(await screen.findByTestId('settings-reset-session'));
    expect(await screen.findByLabelText(/return aim to this device/i)).toBeChecked();
    fireEvent.click(await screen.findByRole('button', { name: 'Start fresh', exact: true }));

    expect(lifecycleReset).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('This device');
  });

  it('Start fresh can retain a remote aim when returning it locally is unchecked', async () => {
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({
      mode: 'transfer', targetIds: ['office'], activityAt: Date.now(),
    }));
    renderDock();

    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(await screen.findByTestId('settings-reset-session'));
    fireEvent.click(await screen.findByLabelText(/return aim to this device/i));
    fireEvent.click(await screen.findByRole('button', { name: 'Start fresh', exact: true }));

    expect(lifecycleReset).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('office');
  });

  it('cancelling Start fresh leaves the local session and shared aim unchanged', async () => {
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({
      mode: 'transfer', targetIds: ['office'], activityAt: Date.now(),
    }));
    renderDock();

    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(await screen.findByTestId('settings-reset-session'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel', exact: true }));

    expect(lifecycleReset).not.toHaveBeenCalled();
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('office');
  });
});
