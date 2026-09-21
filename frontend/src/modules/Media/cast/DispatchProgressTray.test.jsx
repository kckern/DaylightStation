import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { push, retry, removeDispatch } = vi.hoisted(() => ({
  push: vi.fn(),
  retry: vi.fn(),
  removeDispatch: vi.fn(),
}));
const dispatches = new Map();

function addFailedDispatches() {
  dispatches.set('d-living', {
    dispatchId: 'd-living', deviceId: 'livingroom-tv', contentId: 'plex:1', title: 'Bluey',
    mode: 'transfer', status: 'failed', steps: [], playback: null, error: 'offline', failedStep: 'power',
  });
  dispatches.set('d-office', {
    dispatchId: 'd-office', deviceId: 'office-tv', contentId: 'plex:2', title: 'Nova',
    mode: 'fork', status: 'failed', steps: [], playback: null, error: 'timeout', failedStep: 'load',
  });
}

vi.mock('./useDispatch.js', () => ({
  useDispatch: () => ({ dispatches, retry, removeDispatch }),
}));
vi.mock('../fleet/useDevice.js', () => ({
  useDevice: (id) => ({ device: { id, name: id === 'livingroom-tv' ? 'Living Room TV' : 'Office TV' } }),
}));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push }) }));

import { DispatchProgressTray } from './DispatchProgressTray.jsx';

describe('DispatchProgressTray', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatches.clear();
    addFailedDispatches();
  });

  it('renders a confirmed Add as added, never playing', () => {
    dispatches.set('add-1', {
      dispatchId: 'add-1', deviceId: 'office', contentId: 'plex:1', title: 'Arrival',
      operation: 'add', status: 'success', outcome: 'confirmed', steps: [],
      outcomeIdentity: { queueLength: 2, queueRevision: 7 },
    });
    render(<DispatchProgressTray />);
    expect(screen.getByText(/Added Arrival to/i)).toBeTruthy();
    expect(screen.getByText('2nd in queue')).toBeTruthy();
    expect(screen.queryByText(/Playing on/i)).toBeNull();
  });
  it('RELY.6a each failed tray row retries its own dispatchId', () => {
    render(<DispatchProgressTray />);

    fireEvent.click(screen.getByTestId('dispatch-retry-d-living'));
    fireEvent.click(screen.getByTestId('dispatch-retry-d-office'));

    expect(retry).toHaveBeenNthCalledWith(1, 'd-living');
    expect(retry).toHaveBeenNthCalledWith(2, 'd-office');
  });

  it('STEER.1c routes only the selected confirmed dispatch, not another screen', () => {
    dispatches.set('confirmed-office', {
      dispatchId: 'confirmed-office', deviceId: 'office-tv',
      contentId: 'plex:2', title: 'Nova', status: 'success',
      outcome: 'confirmed', steps: [],
    });
    dispatches.set('confirmed-living', {
      dispatchId: 'confirmed-living', deviceId: 'livingroom-tv',
      contentId: 'plex:3', title: 'Bluey', status: 'success',
      outcome: 'confirmed', steps: [],
    });
    render(<DispatchProgressTray />);
    const control = screen.getByTestId('dispatch-remote-confirmed-office');
    expect(control).toHaveTextContent('Steer it');
    fireEvent.click(control);
    expect(push).toHaveBeenCalledWith('peek', { deviceId: 'office-tv' });
    expect(removeDispatch).toHaveBeenCalledWith('confirmed-office');
    expect(push).toHaveBeenCalledTimes(1);
    expect(removeDispatch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dispatch-remote-confirmed-living')).toBeInTheDocument();
  });
});
