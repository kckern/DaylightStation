import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';

// ── Mocks (hook-level, per repo convention — see FleetPlayPicker.test.jsx) ──
const dispatchToTarget = vi.fn();
vi.mock('./DispatchProvider.jsx', () => ({
  useDispatch: () => ({ dispatchToTarget }),
}));

let fleetDevices = [
  { id: 'livingroom-tv', name: 'Living Room TV' },
  { id: 'office-tv', name: 'Office TV' },
];
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: () => ({ devices: fleetDevices }),
}));

// DeviceTile/BusyWarning read per-device live status through useDevice —
// stub it directly rather than standing up a real fleet store.
vi.mock('../fleet/useDevice.js', () => ({
  useDevice: (id) => ({ device: fleetDevices.find((d) => d.id === id) ?? null, entry: null }),
}));

let castTargetState = { targetIds: [], mode: 'transfer' };
vi.mock('./useCastTarget.js', () => ({
  useCastTarget: () => castTargetState,
}));

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import mediaLog from '../logging/mediaLog.js';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';

// Wrap with a LocalSessionContext whose controller reports active local
// playback — this is what makes useLocalPlaybackActive (and therefore the
// transfer/fork toggle) go true, independent of whether `source` has any
// content of its own.
function withLocalPlaybackActive(children) {
  // useSyncExternalStore requires getSnapshot to return a STABLE reference
  // when nothing changed — a fresh object literal per call reads as "always
  // changed" and spins into a render loop. Define the snapshot once.
  const snapshot = { currentItem: { id: 1 }, state: 'playing' };
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
  };
  return (
    <LocalSessionContext.Provider value={{ controller }}>
      {children}
    </LocalSessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fleetDevices = [
    { id: 'livingroom-tv', name: 'Living Room TV' },
    { id: 'office-tv', name: 'Office TV' },
  ];
  castTargetState = { targetIds: [], mode: 'transfer' };
});

describe('DispatchTargetPicker / useDispatchTargetPicker', () => {
  it('logs cast.sheet_opened on mount with every offered device id', () => {
    render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
    expect(mediaLog.castSheetOpened).toHaveBeenCalledWith({
      offeredDeviceIds: ['livingroom-tv', 'office-tv'],
    });
  });

  it('logs cast.sheet_opened exactly once per mount, not per render', () => {
    const { rerender } = render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
    rerender(<DispatchTargetPicker source={{ play: 'plex:1', title: 'changed' }} />);
    expect(mediaLog.castSheetOpened).toHaveBeenCalledTimes(1);
  });

  describe('default intent="dispatch" (CastButton, NowPlayingView — unchanged)', () => {
    it('submit WITH a content source dispatches exactly as before', () => {
      const onComplete = vi.fn();
      render(<DispatchTargetPicker source={{ play: 'plex:1', title: 'Bluey' }} onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      fireEvent.click(screen.getByTestId('picker-submit'));
      expect(dispatchToTarget).toHaveBeenCalledWith({
        targetIds: ['livingroom-tv'], mode: 'transfer', play: 'plex:1', title: 'Bluey',
      });
      expect(onComplete).toHaveBeenCalledWith({ targetIds: ['livingroom-tv'], mode: 'transfer' });
    });

    it('a queue source still dispatches (guard did not narrow to play only)', () => {
      render(<DispatchTargetPicker source={{ queue: 'plex:playlist:1' }} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      fireEvent.click(screen.getByTestId('picker-submit'));
      expect(dispatchToTarget).toHaveBeenCalledWith(
        expect.objectContaining({ queue: 'plex:playlist:1' })
      );
    });

    it('a hand-off snapshot source still dispatches', () => {
      render(<DispatchTargetPicker source={{ getSnapshot: () => ({ sessionId: 's1', currentItem: { contentId: 'plex:1' } }) }} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      fireEvent.click(screen.getByTestId('picker-submit'));
      expect(dispatchToTarget).toHaveBeenCalledWith(
        expect.objectContaining({ snapshot: expect.objectContaining({ sessionId: 's1' }) })
      );
    });

    it('renders the Cast CTA, naming the device', () => {
      render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(screen.getByTestId('picker-submit')).toHaveTextContent('Cast to Living Room TV');
    });

    it('shows the transfer/fork mode toggle when something is playing locally', () => {
      render(withLocalPlaybackActive(<DispatchTargetPicker source={{ play: 'plex:1' }} />));
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(screen.getByTestId('picker-mode-transfer')).toBeInTheDocument();
      expect(screen.getByTestId('picker-mode-fork')).toBeInTheDocument();
    });
  });

  describe('intent="destination" (DestinationLine\'s device sheet)', () => {
    it('submit with NO source does NOT call dispatchToTarget', () => {
      const onComplete = vi.fn();
      render(<DispatchTargetPicker intent="destination" onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      fireEvent.click(screen.getByTestId('picker-submit'));
      expect(dispatchToTarget).not.toHaveBeenCalled();
      // The preference change still happens — onComplete always fires.
      expect(onComplete).toHaveBeenCalledWith({ targetIds: ['livingroom-tv'], mode: 'transfer' });
    });

    it('does not throw and does not leave any dispatch behind when submitted with no content', () => {
      // Regression guard for the bug this fixes: buildDispatchUrl throws
      // without play/queue/snapshot, which (pre-fix) would have surfaced as
      // an unhandled promise rejection from dispatchToTarget and an
      // INITIATED row stuck at "running" forever. With the guard,
      // dispatchToTarget is simply never invoked, so neither can happen.
      render(<DispatchTargetPicker intent="destination" />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(() => fireEvent.click(screen.getByTestId('picker-submit'))).not.toThrow();
      expect(dispatchToTarget).not.toHaveBeenCalled();
    });

    it('renders "Set destination" chrome, never claims to Cast', () => {
      render(<DispatchTargetPicker intent="destination" />);
      expect(screen.getByText('Destination')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(screen.getByTestId('picker-submit')).toHaveTextContent('Set destination: Living Room TV');
      expect(screen.queryByText(/cast/i)).toBeNull();
    });

    it('hides the transfer/fork mode toggle even when something is playing locally — no dispatch happens here', () => {
      render(withLocalPlaybackActive(<DispatchTargetPicker intent="destination" />));
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(screen.queryByTestId('picker-mode-transfer')).toBeNull();
      expect(screen.queryByTestId('picker-mode-fork')).toBeNull();
    });

    it('still respects the single-select/multi-opt-in semantics unchanged', () => {
      render(<DispatchTargetPicker intent="destination" />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      fireEvent.click(screen.getByTestId('picker-device-office-tv'));
      // Single-select by default: picking a second tile REPLACES the first.
      expect(screen.getByTestId('picker-submit')).toHaveTextContent('Set destination: Office TV');
    });
  });
});
