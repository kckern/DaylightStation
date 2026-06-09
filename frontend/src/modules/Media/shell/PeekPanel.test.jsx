import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const pauseFn = vi.fn();
const playFn = vi.fn();
const volumeFn = vi.fn();
let ctl = {
  snapshot: {
    state: 'playing',
    currentItem: { contentId: 'plex:1', title: 'Remote Song' },
    position: 0,
    config: { volume: 50 },
  },
  transport: { play: playFn, pause: pauseFn, stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
  config: { setVolume: volumeFn, setShuffle: vi.fn(), setRepeat: vi.fn(), setShader: vi.fn() },
  queue: {}, lifecycle: {}, portability: {},
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => ctl),
}));

const enterPeek = vi.fn();
const exitPeek = vi.fn();
vi.mock('../peek/usePeek.js', () => ({
  usePeek: vi.fn(() => ({ activePeeks: new Map([['lr', { controller: ctl }]]), enterPeek, exitPeek, getAdapter: vi.fn() })),
}));

vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: vi.fn(() => ({ devices: [{ id: 'lr', name: 'Living Room TV' }], byDevice: new Map() })),
}));

import { PeekPanel } from './PeekPanel.jsx';

beforeEach(() => {
  pauseFn.mockClear();
  playFn.mockClear();
  volumeFn.mockClear();
  enterPeek.mockClear();
  exitPeek.mockClear();
});

describe('PeekPanel', () => {
  it('renders current item title and state', () => {
    render(<PeekPanel deviceId="lr" />);
    expect(screen.getByTestId('peek-panel')).toHaveTextContent('Remote Song');
    expect(screen.getByTestId('peek-panel')).toHaveTextContent('playing');
  });

  it('calls enterPeek on mount', () => {
    render(<PeekPanel deviceId="lr" />);
    expect(enterPeek).toHaveBeenCalledWith('lr');
  });

  it('Pause button calls controller.transport.pause', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.click(screen.getByTestId('peek-pause'));
    expect(pauseFn).toHaveBeenCalled();
  });

  it('Play button calls controller.transport.play', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.click(screen.getByTestId('peek-play'));
    expect(playFn).toHaveBeenCalled();
  });

  it('Volume input calls config.setVolume with a number', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.change(screen.getByTestId('peek-volume'), { target: { value: '80' } });
    expect(volumeFn).toHaveBeenCalledWith(80);
  });

  it('heading shows the human device name, not the raw id', () => {
    render(<PeekPanel deviceId="lr" />);
    expect(screen.getByTestId('peek-panel')).toHaveTextContent('Living Room TV');
  });

  it('seek bar commits transport.seekAbs on release', () => {
    const seekFn = vi.fn();
    ctl = {
      ...ctl,
      snapshot: {
        state: 'playing',
        currentItem: { contentId: 'plex:1', title: 'Remote Song', duration: 300 },
        position: 0,
        config: { volume: 50 },
      },
      transport: { ...ctl.transport, seekAbs: seekFn },
    };
    render(<PeekPanel deviceId="lr" />);
    const bar = screen.getByTestId('peek-seek');
    fireEvent.change(bar, { target: { value: '120' } });
    fireEvent.pointerUp(bar);
    expect(seekFn).toHaveBeenCalledWith(120);
  });

  it('renders the remote queue panel (empty here) inside the peek panel', () => {
    render(<PeekPanel deviceId="lr" />);
    expect(screen.getByTestId('peek-panel').querySelector('[data-testid="queue-empty"], [data-testid="queue-panel"]')).toBeTruthy();
  });

  describe('optimistic state', () => {
    it('flips state label immediately when Pause clicked, even before snapshot updates', () => {
      ctl = {
        ...ctl,
        snapshot: {
          state: 'playing',
          currentItem: { contentId: 'plex:1', title: 'Remote Song' },
          position: 0,
          config: { volume: 50 },
        },
      };
      render(<PeekPanel deviceId="lr" />);
      expect(screen.getByTestId('peek-panel')).toHaveTextContent('state: playing');

      fireEvent.click(screen.getByTestId('peek-pause'));
      // Optimistic flip: state label now reads "paused" even though
      // ctl.snapshot.state is still "playing".
      expect(screen.getByTestId('peek-panel')).toHaveTextContent('state: paused');
    });

    it('greys + disables transport buttons while state is pending', () => {
      render(<PeekPanel deviceId="lr" />);
      fireEvent.click(screen.getByTestId('peek-pause'));
      expect(screen.getByTestId('peek-play')).toBeDisabled();
      expect(screen.getByTestId('peek-pause')).toBeDisabled();
      expect(screen.getByTestId('peek-stop')).toBeDisabled();
      expect(screen.getByTestId('peek-pause').getAttribute('data-pending')).toBe('true');
    });

    it('greys + disables next/prev while currentItem is pending', () => {
      render(<PeekPanel deviceId="lr" />);
      fireEvent.click(screen.getByTestId('peek-next'));
      expect(screen.getByTestId('peek-next')).toBeDisabled();
      expect(screen.getByTestId('peek-prev')).toBeDisabled();
      expect(screen.getByTestId('peek-next').getAttribute('data-pending')).toBe('true');
    });

    it('clears the pending state when snapshot.state catches up with prediction', () => {
      ctl = {
        ...ctl,
        snapshot: {
          state: 'playing',
          currentItem: { contentId: 'plex:1', title: 'Remote Song' },
          position: 0,
          config: { volume: 50 },
        },
      };
      const { rerender } = render(<PeekPanel deviceId="lr" />);
      fireEvent.click(screen.getByTestId('peek-pause'));
      expect(screen.getByTestId('peek-pause')).toBeDisabled();

      // Simulate the WS broadcaster catching up.
      ctl = { ...ctl, snapshot: { ...ctl.snapshot, state: 'paused' } };
      rerender(<PeekPanel deviceId="lr" />);

      expect(screen.getByTestId('peek-pause')).not.toBeDisabled();
      expect(screen.getByTestId('peek-panel')).toHaveTextContent('state: paused');
    });

    it('auto-lifts a pending state after 5s timeout if WS never confirms', () => {
      vi.useFakeTimers();
      ctl = {
        ...ctl,
        snapshot: {
          state: 'playing',
          currentItem: { contentId: 'plex:1', title: 'Remote Song' },
          position: 0,
          config: { volume: 50 },
        },
      };
      try {
        render(<PeekPanel deviceId="lr" />);
        fireEvent.click(screen.getByTestId('peek-pause'));
        expect(screen.getByTestId('peek-pause')).toBeDisabled();

        act(() => {
          vi.advanceTimersByTime(5100);
        });

        // Pending lifted; reverts to the real (still 'playing') state.
        expect(screen.getByTestId('peek-pause')).not.toBeDisabled();
        expect(screen.getByTestId('peek-panel')).toHaveTextContent('state: playing');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
