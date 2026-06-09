import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockTransport = {
  play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
  seekAbs: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn(),
};
const mockConfig = { setVolume: vi.fn() };
let mockSnapshot;

vi.mock('../session/useSessionController.js', () => ({
  useSessionController: () => ({ snapshot: mockSnapshot, transport: mockTransport, config: mockConfig }),
}));
vi.mock('../session/usePlayerHost.js', () => ({ usePlayerHost: () => {} }));
vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ pop: vi.fn(), depth: 2 }) }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: () => <div data-testid="dispatch-target-picker-stub" />,
}));
vi.mock('./QueuePanel.jsx', () => ({
  QueuePanel: () => <div data-testid="queue-panel-stub" />,
}));

import { NowPlayingView } from './NowPlayingView.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  mockSnapshot = {
    state: 'playing',
    position: 30,
    currentItem: { contentId: 'plex:660761', title: 'Bluey S1E1', duration: 420 },
    config: { volume: 80, shuffle: false, repeat: 'off' },
    queue: { items: [{ queueItemId: 'q1', contentId: 'plex:660761' }], currentIndex: 0 },
  };
});

describe('NowPlayingView', () => {
  it('shows the item title, not the raw contentId', () => {
    render(<NowPlayingView />);
    expect(screen.getByRole('heading').textContent).toContain('Bluey S1E1');
    expect(screen.getByRole('heading').textContent).not.toContain('plex:660761');
  });

  it('seek bar commits transport.seekAbs on release', () => {
    render(<NowPlayingView />);
    const bar = screen.getByTestId('np-seek');
    fireEvent.change(bar, { target: { value: '90' } });
    fireEvent.pointerUp(bar);
    expect(mockTransport.seekAbs).toHaveBeenCalledWith(90);
  });

  it('volume slider calls config.setVolume', () => {
    render(<NowPlayingView />);
    fireEvent.change(screen.getByTestId('np-volume'), { target: { value: '40' } });
    expect(mockConfig.setVolume).toHaveBeenCalledWith(40);
  });

  it('hand-off picker is collapsed behind a toggle', () => {
    render(<NowPlayingView />);
    expect(screen.queryByTestId('dispatch-target-picker-stub')).toBeNull();
    fireEvent.click(screen.getByTestId('np-handoff-toggle'));
    expect(screen.getByTestId('dispatch-target-picker-stub')).toBeTruthy();
  });
});
