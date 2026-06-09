import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CastButton } from './CastButton.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { DispatchContext } from './DispatchProvider.jsx';
import { CastTargetContext } from './CastTargetProvider.jsx';

const devices = { 'living-tv': { id: 'living-tv', name: 'Living Room TV', location: 'living' } };

function harness({ dispatchMock = vi.fn() } = {}) {
  return {
    dispatchMock,
    ...render(
      <FleetContext.Provider value={{ devices, byDevice: new Map(), loading: false, error: null, refresh: () => {} }}>
        <CastTargetContext.Provider value={{ targetIds: [], mode: 'transfer', setMode: () => {}, toggleTarget: () => {}, clearTargets: () => {} }}>
          <DispatchContext.Provider value={{ dispatches: {}, dispatchToTarget: dispatchMock, retryLast: () => {} }}>
            <CastButton contentId="plex:42" />
          </DispatchContext.Provider>
        </CastTargetContext.Provider>
      </FleetContext.Provider>,
    ),
  };
}

describe('CastButton', () => {
  test('is enabled even when CastTargetContext has no targets', () => {
    harness();
    expect(screen.getByTestId('cast-button-plex:42')).not.toBeDisabled();
  });

  test('opens the DispatchTargetPicker on click', () => {
    harness();
    fireEvent.click(screen.getByTestId('cast-button-plex:42'));
    expect(screen.getByTestId('dispatch-target-picker')).toBeInTheDocument();
  });

  test('closes the picker after submit', () => {
    const { dispatchMock } = harness();
    fireEvent.click(screen.getByTestId('cast-button-plex:42'));
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    fireEvent.click(screen.getByTestId('picker-submit'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ play: 'plex:42', targetIds: ['living-tv'] }));
    expect(screen.queryByTestId('dispatch-target-picker')).not.toBeInTheDocument();
  });

  test('portal root carries the media-app-portal class so scoped styles apply', () => {
    harness();
    fireEvent.click(screen.getByTestId('cast-button-plex:42'));
    const portal = document.querySelector('.cast-button-popover-portal');
    expect(portal).not.toBeNull();
    expect(portal.classList.contains('media-app-portal')).toBe(true);
  });
});
