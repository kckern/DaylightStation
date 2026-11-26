import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render as renderView, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { createSessionStore } from "../session/sessionStore.js";
import { LocalSessionContext } from "../session/LocalSessionContext.js";

// ── Mocks (hook-level, per repo convention — see FleetPlayPicker.test.jsx) ──
const dispatchToTarget = vi.fn();
vi.mock("./useDispatch.js", () => ({
  useDispatch: () => ({ dispatchToTarget }),
}));

let fleetDevices = [
  { id: 'livingroom-tv', name: 'Living Room TV' },
  { id: 'office-tv', name: 'Office TV' },
];
let fleetEntries = {};
const fleetStore = { getEntry: (id) => fleetEntries[id] ?? null };
const fleetRegistry = {
  screens: [
    { id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', room: 'Living Room' },
    { id: 'fleet:den-speaker', screenId: 'den-speaker', room: 'Living Room' },
    { id: 'fleet:office-tv', screenId: 'office-tv', room: 'Office' },
  ],
  roomAdjacency: {},
};

let fleetIdentity = null;
function withFleet(children, registry = fleetRegistry) {
  return (
    <MantineProvider>
      <FleetContext.Provider value={{ devices: fleetDevices, store: fleetStore, registry, identity: fleetIdentity }}>{children}</FleetContext.Provider>
    </MantineProvider>
  );
}

function render(children) {
  return renderView(children, { wrapper: ({ children }) => withFleet(children) });
}

// DeviceTile/BusyWarning read per-device live status through useDevice —
// stub it directly rather than standing up a real fleet store.
vi.mock("../fleet/useDevice.js", () => ({
  useDevice: (id) => ({ device: fleetDevices.find((d) => d.id === id) ?? null, entry: fleetEntries[id] ?? null }),
}));

let castTargetState = { targetIds: [], mode: 'transfer' };
vi.mock("./useCastTarget.js", () => ({
  useCastTarget: () => castTargetState,
}));

vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({
  DaylightAPI: vi.fn(),
}));

import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import mediaLog from "../logging/mediaLog.js";
import { DispatchTargetPicker } from "./DispatchTargetPicker.jsx";
import { habitsStore } from "../habits/mediaHabits.js";
import { CastTargetContext } from "./CastTargetProvider.jsx";

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
  fleetEntries = {};
  dispatchToTarget.mockResolvedValue(['dispatch-1']);
  fleetDevices = [
    { id: 'livingroom-tv', name: 'Living Room TV' },
    { id: 'office-tv', name: 'Office TV' },
  ];
  castTargetState = { targetIds: [], mode: 'transfer' };
  fleetIdentity = null;
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

  describe('rows: one shape for every screen', () => {
    it('reads "Room · status" on every row, with a status even for a screen that never reported', () => {
      fleetDevices = [
        { id: 'livingroom-tv', name: 'Living Room TV', type: 'shield-tv', location: 'Living Room' },
        { id: 'office-tv', name: 'Office Screen', type: 'linux-pc', location: 'Office' },
        { id: 'yellow-room-tablet', name: 'Piano Tablet', type: 'android-tablet', location: 'Yellow Room' },
      ];
      fleetEntries = {
        'office-tv': { snapshot: { state: 'idle' } },
        'yellow-room-tablet': { offline: true, snapshot: { state: 'idle' } },
      };
      render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
      expect(screen.getByTestId('picker-device-status-livingroom-tv')).toHaveTextContent('Living Room · Ready');
      expect(screen.getByTestId('picker-device-status-office-tv')).toHaveTextContent('Office · Ready');
      expect(screen.getByTestId('picker-device-status-yellow-room-tablet')).toHaveTextContent('Yellow Room · Asleep');
    });

    it('has no confirm button and no title of its own in single-select', () => {
      render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
      expect(screen.queryByTestId('picker-submit')).toBeNull();
      expect(screen.queryByText('Cast to')).toBeNull();
    });
  });

  describe('a tap sends', () => {
    it('PLACE.2b keeps This device out when there is no local session to run it', () => {
      render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
      expect(screen.queryByTestId('picker-this-device')).toBeNull();
    });

    it('NF-TAP-10: tapping an idle screen sends a plain Play at once, without a Move option', async () => {
      const onComplete = vi.fn();
      render(<DispatchTargetPicker source={{ play: 'plex:1', title: 'Bluey' }} onComplete={onComplete} />);
      expect(screen.queryByTestId('picker-stop-here')).toBeNull();
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(dispatchToTarget).toHaveBeenCalledWith({
        targetIds: ['livingroom-tv'], mode: 'fork', play: 'plex:1', title: 'Bluey',
      });
      await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ targetIds: ['livingroom-tv'], mode: 'fork' }));
    });

    it('a busy screen asks in its own row, and its one confirm sends', () => {
      fleetEntries = { 'livingroom-tv': { snapshot: { state: 'playing', currentItem: { title: 'Arrival' } } } };
      render(<DispatchTargetPicker source={{ play: 'plex:1', title: 'Bluey' }} verb="Play" />);
      expect(screen.getByTestId('picker-device-status-livingroom-tv')).toHaveTextContent('Playing: Arrival');
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(dispatchToTarget).not.toHaveBeenCalled();
      expect(screen.getByTestId('cast-busy-warning-livingroom-tv')).toHaveTextContent('Replace Arrival?');
      expect(screen.queryByTestId('picker-submit')).toBeNull();
      fireEvent.click(screen.getByTestId('picker-replace-livingroom-tv'));
      expect(screen.queryByTestId('cast-busy-warning-livingroom-tv')).toBeNull();
      expect(dispatchToTarget).toHaveBeenCalledTimes(1);
      expect(dispatchToTarget.mock.calls[0][0]).toMatchObject({ targetIds: ['livingroom-tv'], play: 'plex:1' });
    });

    it('the replace confirm names the verb', () => {
      fleetEntries = { 'livingroom-tv': { snapshot: { state: 'paused', currentItem: { title: 'Arrival' } } } };
      render(<DispatchTargetPicker source={{ play: 'plex:1' }} verb="Play" />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(screen.getByTestId('picker-replace-livingroom-tv')).toHaveTextContent('Play here instead');
    });

    it('a second tap on the asking row sends too', () => {
      fleetEntries = { 'livingroom-tv': { snapshot: { state: 'playing', currentItem: { title: 'Arrival' } } } };
      render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(dispatchToTarget).toHaveBeenCalledTimes(1);
    });

    it('Add on… never asks to replace: an add appends', () => {
      fleetEntries = { 'livingroom-tv': { snapshot: { state: 'playing', currentItem: { title: 'Arrival' } } } };
      const item = { contentId: 'plex:9', title: 'Song' };
      render(<DispatchTargetPicker source={{ queue: 'plex:9', itemAction: { kind: 'add', item } }} verb="Add" />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(dispatchToTarget).toHaveBeenCalledTimes(1);
    });

    it('a hand-off source sends on the tap, as Move by default', async () => {
      render(<DispatchTargetPicker source={{ getSnapshot: () => ({ sessionId: 's1', currentItem: { contentId: 'plex:1' } }) }} />);
      expect(screen.getByRole('switch', { name: 'Stop it here' })).toBeChecked();
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      // Move goes through the hand-off, never a plain dispatch.
      expect(dispatchToTarget).not.toHaveBeenCalled();
    });

    it('keeps the picker open and reports failure when a dispatch returns no ids', async () => {
      dispatchToTarget.mockResolvedValueOnce([]);
      const onComplete = vi.fn();
      render(<DispatchTargetPicker source={{ play: 'plex:1', title: 'Bluey' }} onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(await screen.findByTestId('picker-dispatch-failed')).toHaveTextContent('Could not start playback on that device');
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('keeps the picker open and reports failure when dispatch rejects', async () => {
      dispatchToTarget.mockRejectedValueOnce(new Error('offline'));
      const onComplete = vi.fn();
      render(<DispatchTargetPicker source={{ play: 'plex:1', title: 'Bluey' }} onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(await screen.findByTestId('picker-dispatch-failed')).toHaveTextContent('Could not start playback on that device');
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('a queue source dispatches its queue', () => {
      render(<DispatchTargetPicker source={{ queue: 'plex:playlist:1' }} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(dispatchToTarget).toHaveBeenCalledWith(expect.objectContaining({ queue: 'plex:playlist:1' }));
    });

    it('a hand-off with Stop it here off sends the snapshot as Keep', () => {
      render(<DispatchTargetPicker source={{ getSnapshot: () => ({ sessionId: 's1', currentItem: { contentId: 'plex:1' } }) }} />);
      fireEvent.click(screen.getByRole('switch', { name: 'Stop it here' }));
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(dispatchToTarget).toHaveBeenCalledWith(
        expect.objectContaining({ snapshot: expect.objectContaining({ sessionId: 's1' }), mode: 'fork' })
      );
    });
  });

  describe('"Usual" and Here', () => {
    const film = { contentId: 'plex:775444', title: 'Sonic the Hedgehog', type: 'movie', format: 'video' };
    const filmSource = { play: film.contentId, title: film.title, itemAction: { kind: 'playNow', item: film } };

    it('tags the learned screen "Usual" and only that one', () => {
      habitsStore().recordScreen('video', ['office-tv']);
      render(<DispatchTargetPicker source={filmSource} verb="Play" />);
      expect(screen.getByTestId('picker-device-office-tv-usual')).toHaveTextContent('Usual');
      expect(screen.queryByTestId('picker-device-livingroom-tv-usual')).toBeNull();
    });

    it('a sticky This device (here) still tags the usual screen and lists it first', () => {
      habitsStore().recordScreen('video', ['office-tv']);
      render(
        <CastTargetContext.Provider value={{ targetIds: [], here: true, mode: 'transfer' }}>
          <DispatchTargetPicker source={filmSource} verb="Play" />
        </CastTargetContext.Provider>
      );
      expect(screen.getByTestId('picker-device-office-tv-usual')).toHaveTextContent('Usual');
      const rows = screen.getAllByRole('button').map((el) => el.dataset.testid).filter((id) => id?.startsWith('picker-device-') && !id.endsWith('-usual'));
      expect(rows[0]).toBe('picker-device-office-tv');
    });

    function localSession({ state = 'paused', title = 'Sonic the Hedgehog', execute = vi.fn(async () => ({ ok: true })) } = {}) {
      const snapshot = { currentItem: { contentId: 'plex:1', title }, state };
      const controller = { id: 'local', subscribe: () => () => {}, getSnapshot: () => snapshot, execute, portability: { capture: () => ({}) } };
      return { execute, wrap: (children) => <LocalSessionContext.Provider value={{ controller }}>{children}</LocalSessionContext.Provider> };
    }

    it('lists this device last, never among the screens, as "Here (this Mac)" with what it plays', () => {
      fleetIdentity = { deviceId: 'browser:abc' };
      fleetDevices = [...fleetDevices, { id: 'browser:abc', name: 'Mac', type: 'browser', isLocal: true }];
      const { wrap } = localSession();
      render(wrap(<DispatchTargetPicker source={filmSource} verb="Play" />));
      expect(screen.queryByTestId('picker-device-browser:abc')).toBeNull();
      expect(screen.getByTestId('picker-this-device')).toHaveTextContent('Here (this Mac)');
      expect(screen.getByTestId('picker-this-device-status')).toHaveTextContent('Paused: Sonic the Hedgehog');
      const rows = screen.getAllByRole('button').map((el) => el.dataset.testid).filter((id) => id?.startsWith('picker-'));
      expect(rows.indexOf('picker-this-device')).toBeGreaterThan(rows.indexOf('picker-device-office-tv'));
    });

    it('reads plain "Here" when the browser has no name', () => {
      fleetIdentity = { deviceId: 'browser:abc' };
      fleetDevices = [...fleetDevices, { id: 'browser:abc', name: 'Browser 4778f429', type: 'browser', isLocal: true }];
      const { wrap } = localSession({ state: 'idle' });
      render(wrap(<DispatchTargetPicker source={filmSource} verb="Play" />));
      expect(screen.getByTestId('picker-this-device')).toHaveTextContent(/^Here$/);
    });

    it('Here asks before replacing what plays here, then runs the item on this device', async () => {
      const onComplete = vi.fn();
      const { execute, wrap } = localSession();
      render(wrap(<DispatchTargetPicker source={filmSource} verb="Play" onComplete={onComplete} />));
      fireEvent.click(screen.getByTestId('picker-this-device'));
      expect(execute).not.toHaveBeenCalled();
      expect(screen.getByTestId('cast-busy-warning-this-device')).toHaveTextContent('Replace Sonic the Hedgehog?');
      fireEvent.click(screen.getByTestId('picker-replace-this-device'));
      await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
      expect(execute.mock.calls[0][0]).toMatchObject({ kind: 'playNow', item: expect.objectContaining({ contentId: film.contentId }) });
      expect(dispatchToTarget).not.toHaveBeenCalled();
      await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ targetIds: [], mode: 'fork' }));
      expect(mediaLog.playOnHere).toHaveBeenCalled();
    });

    it('Here runs at once when nothing plays here', async () => {
      const { execute, wrap } = localSession({ state: 'idle' });
      render(wrap(<DispatchTargetPicker source={filmSource} verb="Play" />));
      fireEvent.click(screen.getByTestId('picker-this-device'));
      await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    });

    it('a brief show never offers Here', () => {
      const { wrap } = localSession();
      render(wrap(<DispatchTargetPicker source={{ ...filmSource, brief: true }} verb="Show briefly" />));
      expect(screen.queryByTestId('picker-this-device')).toBeNull();
    });
  });

  describe('PLACE.6a/AC2 — item-level Play on… asks Move or Keep when something plays here', () => {
    function localWith({ stopIfCurrent = vi.fn(() => ({ ok: true })), capture = () => ({ identity: { ownerInstanceId: 'o1', playbackRevision: 3 } }) } = {}) {
      const snapshot = { currentItem: { id: 1 }, state: 'playing' };
      const controller = {
        subscribe: () => () => {}, getSnapshot: () => snapshot,
        portability: { capture, stopIfCurrent },
        transport: { stop: vi.fn() },
      };
      return { controller, stopIfCurrent, wrap: (children) => (
        <LocalSessionContext.Provider value={{ controller }}>{children}</LocalSessionContext.Provider>
      ) };
    }

    it('shows one "Stop it here" switch for a plain play source, with no unavailable noise', () => {
      render(withLocalPlaybackActive(<DispatchTargetPicker source={{ play: 'plex:1' }} />));
      expect(screen.getByRole('switch', { name: 'Stop it here' })).toBeInTheDocument();
      expect(screen.queryByTestId('picker-move-unavailable')).toBeNull();
    });

    it('shows the switch only while something plays here', () => {
      const idle = { state: 'idle', currentItem: null };
      const controller = createSessionStore(idle);
      render(<LocalSessionContext.Provider value={{ controller }}>
        <DispatchTargetPicker source={{ play: 'plex:1' }} />
      </LocalSessionContext.Provider>);
      expect(screen.queryByRole('switch')).toBeNull();
      act(() => controller.replace({ state: 'paused', currentItem: { contentId: 'plex:2' } }));
      expect(screen.getByRole('switch', { name: 'Stop it here' })).toBeInTheDocument();
      act(() => controller.replace(idle));
      expect(screen.queryByRole('switch')).toBeNull();
    });

    it('a tap still sends at once while something plays here', () => {
      render(withLocalPlaybackActive(<DispatchTargetPicker source={{ play: 'plex:1' }} />));
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(dispatchToTarget).toHaveBeenCalledTimes(1);
    });

    it('is pre-set to the remembered choice', () => {
      castTargetState = { targetIds: [], mode: 'fork', setMode: vi.fn() };
      render(withLocalPlaybackActive(<DispatchTargetPicker source={{ play: 'plex:1' }} />));
      expect(screen.getByRole('switch', { name: 'Stop it here' })).not.toBeChecked();
    });

    it('Keep (switch off) sends and leaves this device playing; the choice is remembered', async () => {
      const setMode = vi.fn();
      castTargetState = { targetIds: [], mode: 'transfer', setMode };
      const { stopIfCurrent, wrap } = localWith();
      render(wrap(<DispatchTargetPicker source={{ play: 'plex:1' }} />));
      fireEvent.click(screen.getByRole('switch', { name: 'Stop it here' }));
      expect(setMode).toHaveBeenCalledWith('fork');
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      await waitFor(() => expect(dispatchToTarget).toHaveBeenCalled());
      expect(dispatchToTarget.mock.calls[0][0]).toMatchObject({ mode: 'fork', play: 'plex:1' });
      expect(dispatchToTarget.mock.calls[0][0].onConfirmed).toBeUndefined();
      expect(stopIfCurrent).not.toHaveBeenCalled();
    });

    it('Move (switch on) sends as a second-room start and stops this device only after the screen confirmed playing', async () => {
      castTargetState = { targetIds: [], mode: 'transfer', setMode: vi.fn() };
      const { stopIfCurrent, wrap } = localWith();
      render(wrap(<DispatchTargetPicker source={{ play: 'plex:1' }} />));
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      await waitFor(() => expect(dispatchToTarget).toHaveBeenCalled());
      const params = dispatchToTarget.mock.calls[0][0];
      expect(params.mode).toBe('fork');
      expect(typeof params.onConfirmed).toBe('function');
      expect(stopIfCurrent).not.toHaveBeenCalled();
      params.onConfirmed();
      expect(stopIfCurrent).toHaveBeenCalledWith({ ownerInstanceId: 'o1', playbackRevision: 3 });
    });
  });

  describe('intent="destination" (DestinationLine\'s device sheet)', () => {
    it('PLACE.2b offers Here and selects the local aim immediately', () => {
      const onComplete = vi.fn();
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      render(<DispatchTargetPicker intent="destination" onComplete={onComplete} />);
      const localChoice = screen.getByTestId('picker-this-device');
      expect(localChoice).toHaveTextContent('Here');
      expect(localChoice).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId('picker-device-livingroom-tv')).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(localChoice);
      expect(onComplete).toHaveBeenCalledWith({ targetIds: [], mode: 'transfer' });
      expect(dispatchToTarget).not.toHaveBeenCalled();
    });

    it('a tap on a screen sets the destination at once and never dispatches', () => {
      const onComplete = vi.fn();
      render(<DispatchTargetPicker intent="destination" onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(dispatchToTarget).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith({ targetIds: ['livingroom-tv'], mode: 'transfer' });
    });

    it('a busy screen does not ask: nothing is replaced by choosing a destination', () => {
      fleetEntries = { 'livingroom-tv': { snapshot: { state: 'playing', currentItem: { title: 'Arrival' } } } };
      const onComplete = vi.fn();
      render(<DispatchTargetPicker intent="destination" onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      expect(screen.queryByTestId('cast-busy-warning-livingroom-tv')).toBeNull();
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('several screens: the confirm says "Set destination", never Cast', () => {
      render(<DispatchTargetPicker intent="destination" />);
      fireEvent.click(screen.getByTestId('picker-multi-toggle'));
      fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
      fireEvent.click(screen.getByTestId('picker-device-office-tv'));
      expect(screen.getByTestId('picker-submit')).toHaveTextContent('Set destination: Living Room TV + Office TV');
      expect(screen.queryByText(/cast/i)).toBeNull();
    });

    it('hides the Stop it here switch even when something is playing locally', () => {
      render(withLocalPlaybackActive(<DispatchTargetPicker intent="destination" />));
      expect(screen.queryByRole('switch')).toBeNull();
    });
  });
});


describe('DispatchTargetPicker — several screens (PLACE.4a)', () => {
  beforeEach(() => {
    fleetDevices = [
      { id: 'livingroom-tv', name: 'Living Room TV' },
      { id: 'den-speaker', name: 'Den speaker' },
      { id: 'office-tv', name: 'Office TV' },
    ];
  });

  it('labels the choice "several screens", names them in the action, and warns when two share a room', async () => {
    render(<DispatchTargetPicker source={{ play: 'plex:1', title: 'Song' }} />);
    const toggle = screen.getByTestId('picker-multi-toggle');
    expect(toggle).toHaveTextContent('Choose several screens');
    expect(screen.queryByTestId('picker-submit')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('picker-multi-toggle')).toHaveTextContent('Choose one screen');
    expect(screen.getByTestId('picker-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
    fireEvent.click(screen.getByTestId('picker-device-office-tv'));
    expect(dispatchToTarget).not.toHaveBeenCalled();
    expect(screen.getByTestId('picker-submit')).toHaveTextContent('Cast to Living Room TV + Office TV');
    expect(screen.queryByTestId('picker-drift-warning')).toBeNull();
    fireEvent.click(screen.getByTestId('picker-device-den-speaker'));
    expect(await screen.findByTestId('picker-drift-warning')).toHaveTextContent(
      // Screens are listed by name (a stable order), so the warning names them that way.
      'Den speaker and Living Room TV are both in Living Room — they start together but can drift apart, and you may hear it.',
    );
    expect(mediaLog.aimDriftWarned).toHaveBeenCalledWith(expect.objectContaining({ state: 'shown', rooms: ['Living Room'] }));
  });

  it('updates the drift warning when a selected screen changes rooms while the picker is open', async () => {
    const picker = <DispatchTargetPicker source={{ play: 'plex:1', title: 'Song' }} />;
    const { rerender } = renderView(withFleet(picker));
    fireEvent.click(screen.getByTestId('picker-multi-toggle'));
    fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
    fireEvent.click(screen.getByTestId('picker-device-den-speaker'));
    expect(await screen.findByTestId('picker-drift-warning')).toHaveTextContent('both in Living Room');

    rerender(withFleet(picker, {
      ...fleetRegistry,
      screens: fleetRegistry.screens.map((entry) => entry.screenId === 'den-speaker' ? { ...entry, room: 'Den' } : entry),
      roomAdjacency: { Den: ['Living Room'] },
    }));

    expect(screen.getByTestId('picker-drift-warning')).toHaveTextContent('neighbouring rooms (Den and Living Room)');
    expect(screen.getByTestId('picker-device-den-speaker')).toHaveAttribute('aria-pressed', 'true');
    expect(DaylightAPI).not.toHaveBeenCalled();
  });
});

describe('DispatchTargetPicker — only the screens that can take it, the usual one first', () => {
  beforeEach(() => {
    fleetDevices = [
      { id: 'livingroom-tv', name: 'Living Room TV', type: 'shield-tv', content_control: { type: 'fully' } },
      { id: 'speaker-red', name: 'Red Headset', type: 'speaker', fleet: true },
      { id: 'garage-tv', name: 'Garage Gym TV', type: 'linux-pc', fleet: true },
      { id: 'office-tv', name: 'Office Screen', type: 'linux-pc', content_control: { type: 'websocket' } },
    ];
  });

  const film = { contentId: 'plex:775444', title: 'Sonic the Hedgehog', type: 'movie', format: 'video' };
  const song = { contentId: 'plex:565457', title: 'Marble Zone', type: 'track', format: 'audio' };
  const offered = () => screen.getAllByTestId(/^picker-device-[^s]/).map((el) => el.dataset.testid.replace('picker-device-', ''))
    .filter((id) => !id.startsWith('status-') && !id.endsWith('-usual'));

  it('a film never lists a headset, and a display that takes no content is never listed', () => {
    render(<DispatchTargetPicker source={{ play: film.contentId, title: film.title, itemAction: { kind: 'playNow', item: film } }} />);
    expect(offered()).toEqual(['livingroom-tv', 'office-tv']);
  });

  it('a song lists the headsets too', () => {
    render(<DispatchTargetPicker source={{ play: song.contentId, title: song.title, itemAction: { kind: 'playNow', item: song } }} />);
    expect(screen.getByTestId('picker-device-speaker-red')).toBeInTheDocument();
    expect(screen.queryByTestId('picker-device-garage-tv')).toBeNull();
  });

  it('lists the screen this browser last played films on first, then by name, and a pick teaches it', async () => {
    habitsStore().recordScreen('video', ['office-tv']);
    render(<DispatchTargetPicker source={{ play: film.contentId, title: film.title, itemAction: { kind: 'playNow', item: film } }} />);
    expect(offered()).toEqual(['office-tv', 'livingroom-tv']);
    fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
    await waitFor(() => expect(habitsStore().screenFor('video')).toEqual(['livingroom-tv']));
  });
});

// Addendum item 2 (2026-11-26): picker states.
import { DispatchContext } from "./DispatchProvider.jsx";
import { PeekContext } from "../peek/PeekContext.js";
describe('picker states (addendum item 2)', () => {
  const startOn = (deviceId, steps = []) => new Map([['s1', {
    attemptId: 's1', targetId: deviceId, distance: 'far', kind: 'play', phase: 'running', status: 'running',
    item: { contentId: 'plex:2', title: 'Arrival' }, steps, createdAt: '2026-11-26T10:00:00.000Z',
  }]]);

  it('a screen that is off reads Asleep; a tap still sends (waking it is the send)', () => {
    fleetDevices = [{ id: 'office-tv', name: 'Office Screen', location: 'Office' }];
    fleetEntries = { 'office-tv': { offline: true } };
    render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
    expect(screen.getByTestId('picker-device-status-office-tv')).toHaveTextContent('Office · Asleep');
    expect(screen.getByTestId('picker-device-office-tv')).not.toBeDisabled();
  });

  it('a screen a start is waking reads Waking up… with a spinner, and is disabled with that reason', () => {
    fleetDevices = [{ id: 'office-tv', name: 'Office Screen', location: 'Office' }];
    fleetEntries = { 'office-tv': { offline: true } };
    render(
      <DispatchContext.Provider value={{ outcomes: startOn('office-tv', [{ step: 'power', status: 'running' }]) }}>
        <DispatchTargetPicker source={{ play: 'plex:1' }} />
      </DispatchContext.Provider>,
    );
    expect(screen.getByTestId('picker-device-status-office-tv')).toHaveTextContent('Waking up…');
    expect(screen.getByTestId('picker-device-office-tv-busy')).toBeInTheDocument();
    expect(screen.getByTestId('picker-device-office-tv')).toBeDisabled();
    expect(screen.getByTestId('picker-device-office-tv')).toHaveAccessibleDescription(/Waking up…/);
  });

  it('a screen already loading reads Starting <title>…', () => {
    fleetDevices = [{ id: 'office-tv', name: 'Office Screen' }];
    fleetEntries = { 'office-tv': { snapshot: { state: 'idle' } } };
    render(
      <DispatchContext.Provider value={{ outcomes: startOn('office-tv', [{ step: 'load', status: 'running' }]) }}>
        <DispatchTargetPicker source={{ play: 'plex:1' }} />
      </DispatchContext.Provider>,
    );
    expect(screen.getByTestId('picker-device-status-office-tv')).toHaveTextContent('Starting Arrival…');
  });

  it('a screen already playing this item reads ✓ Playing this and is not offered again', () => {
    fleetDevices = [{ id: 'office-tv', name: 'Office Screen' }];
    fleetEntries = { 'office-tv': { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1', title: 'Hospital' } } } };
    render(<DispatchTargetPicker source={{ play: 'plex:1' }} />);
    expect(screen.getByTestId('picker-device-status-office-tv')).toHaveTextContent('Playing this');
    expect(screen.getByTestId('picker-device-office-tv').closest('.cast-row')).toHaveAttribute('data-state', 'playing-this');
    expect(screen.getByTestId('picker-device-office-tv')).toBeDisabled();
  });

  it('the aimed screen, while it plays, shows its volume with −/+ steps (no slider)', () => {
    fleetDevices = [{ id: 'office-tv', name: 'Office Screen' }];
    fleetEntries = { 'office-tv': { snapshot: { state: 'playing', config: { volume: 40 }, currentItem: { contentId: 'plex:9', title: 'Bluey' } } } };
    castTargetState = { targetIds: ['office-tv'], mode: 'transfer' };
    const setVolume = vi.fn(async () => ({ ok: true }));
    render(
      <PeekContext.Provider value={{ getController: () => ({ config: { setVolume } }) }}>
        <DispatchTargetPicker source={{ play: 'plex:1' }} />
      </PeekContext.Provider>,
    );
    expect(screen.getByTestId('picker-volume-value-office-tv')).toHaveTextContent('40%');
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByTestId('picker-volume-up-office-tv'));
    expect(setVolume).toHaveBeenCalledWith(45);
    expect(screen.getByTestId('picker-volume-value-office-tv')).toHaveTextContent('45%');
    fireEvent.click(screen.getByTestId('picker-volume-down-office-tv'));
    expect(setVolume).toHaveBeenLastCalledWith(40);
    castTargetState = { targetIds: [], mode: 'transfer' };
  });
});

describe('DispatchTargetPicker: smart long list (addendum 2026-11-26 (b))', () => {
  const HOUSE = [
    { id: 'zeta-tv', name: 'Zeta TV', displayState: 'idle' },
    { id: 'alpha-tv', name: 'Alpha TV', displayState: 'idle' },
    { id: 'den-tv', name: 'Den TV', displayState: 'off' },
    { id: 'kitchen-tv', name: 'Kitchen TV', displayState: 'playing' },
    { id: 'garage-tv', name: 'Garage TV', displayState: 'off' },
    { id: 'browser:tab', name: 'Phone', type: 'browser', displayState: 'idle' },
  ];
  const film = { itemAction: { kind: 'playNow', item: { contentId: 'plex:1', id: 'plex:1', title: 'Arrival', type: 'movie' } } };
  const rows = () => screen.queryAllByTestId(/^picker-device-[^s]/).filter((el) => !/-(usual|busy)$/.test(el.dataset.testid));

  beforeEach(() => {
    localStorage.clear();
    fleetDevices = HOUSE;
  });

  it('shows three screens (usual, then what is on, then by name); asleep screens and browser tabs under More', () => {
    habitsStore().recordScreen('video', ['den-tv']);
    render(<DispatchTargetPicker source={film} verb="Play" />);
    expect(rows().map((el) => el.dataset.testid)).toEqual(['picker-device-den-tv', 'picker-device-kitchen-tv', 'picker-device-alpha-tv']);
    expect(screen.getByTestId('picker-more')).toHaveTextContent('More (3)');
  });

  it('More expands in place, focuses the first newly shown screen and is logged', async () => {
    render(<DispatchTargetPicker source={film} verb="Play" />);
    fireEvent.click(screen.getByTestId('picker-more'));
    expect(rows()).toHaveLength(6);
    expect(screen.queryByTestId('picker-more')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('picker-device-den-tv')));
    expect(mediaLog.listMoreExpanded).toHaveBeenCalledWith({ surface: 'play-on', shown: 3, hidden: 3 });
  });

  it('the aimed screen is always shown, even asleep and unranked', () => {
    castTargetState = { targetIds: ['garage-tv'], mode: 'transfer' };
    render(<DispatchTargetPicker source={film} verb="Play" />);
    expect(screen.getByTestId('picker-device-garage-tv')).toBeInTheDocument();
  });
});
