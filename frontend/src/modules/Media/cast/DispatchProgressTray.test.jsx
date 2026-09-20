import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const retry = vi.fn();
const removeDispatch = vi.fn();
const dispatches = new Map([
  ['d-living', {
    dispatchId: 'd-living', deviceId: 'livingroom-tv', contentId: 'plex:1', title: 'Bluey',
    mode: 'transfer', status: 'failed', steps: [], playback: null, error: 'offline', failedStep: 'power',
  }],
  ['d-office', {
    dispatchId: 'd-office', deviceId: 'office-tv', contentId: 'plex:2', title: 'Nova',
    mode: 'fork', status: 'failed', steps: [], playback: null, error: 'timeout', failedStep: 'load',
  }],
]);

vi.mock('./useDispatch.js', () => ({
  useDispatch: () => ({ dispatches, retry, removeDispatch }),
}));
vi.mock('../fleet/useDevice.js', () => ({
  useDevice: (id) => ({ device: { id, name: id === 'livingroom-tv' ? 'Living Room TV' : 'Office TV' } }),
}));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push: vi.fn() }) }));

import { DispatchProgressTray } from './DispatchProgressTray.jsx';

describe('DispatchProgressTray', () => {
  it('renders a confirmed Add as added, never playing', () => {
    dispatches.set('add-1', {
      dispatchId: 'add-1', deviceId: 'office', contentId: 'plex:1', title: 'Arrival',
      operation: 'add', status: 'success', outcome: 'confirmed', steps: [],
    });
    render(<DispatchProgressTray />);
    expect(screen.getByText(/Added Arrival to/i)).toBeTruthy();
    expect(screen.queryByText(/Playing on/i)).toBeNull();
  });
  it('RELY.6a each failed tray row retries its own dispatchId', () => {
    render(<DispatchProgressTray />);

    fireEvent.click(screen.getByTestId('dispatch-retry-d-living'));
    fireEvent.click(screen.getByTestId('dispatch-retry-d-office'));

    expect(retry).toHaveBeenNthCalledWith(1, 'd-living');
    expect(retry).toHaveBeenNthCalledWith(2, 'd-office');
  });
});
