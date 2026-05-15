import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { DispatchContext } from './DispatchProvider.jsx';
import { CastTargetContext } from './CastTargetProvider.jsx';

const devices = {
  'living-tv': { id: 'living-tv', name: 'Living Room TV', location: 'living_room' },
  'office-tv': { id: 'office-tv', name: 'Office TV', location: 'office' },
};

function renderPicker({ source = { play: 'plex:42' }, defaults = { targetIds: [], mode: 'transfer' }, dispatchMock = vi.fn() } = {}) {
  return {
    dispatchMock,
    ...render(
      <FleetContext.Provider value={{ devices, byDevice: new Map(), loading: false, error: null, refresh: () => {} }}>
        <CastTargetContext.Provider value={{ ...defaults, setMode: () => {}, toggleTarget: () => {}, clearTargets: () => {} }}>
          <DispatchContext.Provider value={{ dispatches: {}, dispatchToTarget: dispatchMock, retryLast: () => {} }}>
            <DispatchTargetPicker source={source} onComplete={() => {}} />
          </DispatchContext.Provider>
        </CastTargetContext.Provider>
      </FleetContext.Provider>,
    ),
  };
}

describe('DispatchTargetPicker', () => {
  test('lists every device from the fleet', () => {
    renderPicker();
    expect(screen.getByTestId('picker-device-living-tv')).toBeInTheDocument();
    expect(screen.getByTestId('picker-device-office-tv')).toBeInTheDocument();
  });

  test('cast is disabled until a device is selected', () => {
    renderPicker();
    expect(screen.getByTestId('picker-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    expect(screen.getByTestId('picker-submit')).not.toBeDisabled();
  });

  test('submits dispatch with selected target ids and chosen mode', () => {
    const { dispatchMock } = renderPicker({ source: { play: 'plex:42' } });
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    fireEvent.click(screen.getByTestId('picker-mode-fork'));
    fireEvent.click(screen.getByTestId('picker-submit'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      targetIds: ['living-tv'],
      mode: 'fork',
      play: 'plex:42',
    }));
  });

  test('default mode is transfer', () => {
    const { dispatchMock } = renderPicker();
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    fireEvent.click(screen.getByTestId('picker-submit'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'transfer' }));
  });

  test('respects defaults from CastTargetContext as initial selection', () => {
    renderPicker({ defaults: { targetIds: ['office-tv'], mode: 'fork' } });
    const officeCheckbox = within(screen.getByTestId('picker-device-office-tv')).getByRole('checkbox');
    expect(officeCheckbox).toBeChecked();
    const forkRadio = screen.getByTestId('picker-mode-fork').querySelector('input');
    expect(forkRadio).toBeChecked();
  });

  test('supports a queue source (handoff snapshot)', () => {
    const snapshot = { sessionId: 'abc', currentItem: { contentId: 'plex:7' }, position: 12, queue: {}, config: {}, state: 'paused', meta: {} };
    const { dispatchMock } = renderPicker({ source: { snapshot } });
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    fireEvent.click(screen.getByTestId('picker-submit'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      snapshot,
      targetIds: ['living-tv'],
    }));
  });
});
