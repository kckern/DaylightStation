// Fling: send what plays here to a screen from the handle / transport, in one
// step. Reuses the local hand-off (cast/useHandOff.js); the screen starts from
// the beginning unless the person chooses "Start where I am" (offered past 10%).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";

const handOff = vi.fn();
vi.mock("../cast/useHandOff.js", () => ({ useHandOff: () => handOff }));
const log = vi.hoisted(() => {
  const calls = {};
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= ((...a) => { (calls[k] ??= []).push(a); })) });
  return { stub, calls };
});
vi.mock("../logging/mediaLog.js", () => ({ default: log.stub, mediaLog: log.stub }));

import { FlingButton } from "./FlingButton.jsx";

const devices = [
  { id: 'office-tv', name: 'Office TV', location: 'Office', content_control: {} },
  { id: 'den-tv', name: 'Den TV', fleet: true },
  { id: 'browser:other', name: 'A phone' },
];

let state;
function makeController() {
  return {
    getSnapshot: () => state.snapshot,
    subscribe: () => () => {},
    position: { get: () => state.position, subscribe: () => () => {} },
    transport: { stop: vi.fn() },
    portability: { capture: vi.fn() },
  };
}

function snapshotAt({ playerState = 'playing', duration = 6000, isLive = false } = {}) {
  return {
    state: playerState,
    position: 0,
    currentItem: { contentId: 'plex:42', title: 'A Long Film', duration, format: 'video', ...(isLive ? { isLive: true } : {}) },
    queue: { items: [{ queueItemId: 'q1', contentId: 'plex:42', title: 'A Long Film' }], currentIndex: 0, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', volume: 100, shader: null },
  };
}

function renderFling({ fleetDevices = devices, controller = makeController(), outcomes } = {}) {
  const recordLocal = vi.fn(() => 'attempt-1');
  const resolveLocal = vi.fn();
  const utils = render(
    <MantineProvider>
      <FleetContext.Provider value={{ devices: fleetDevices, store: null }}>
        <LocalSessionContext.Provider value={{ controller }}>
          <DispatchContext.Provider value={outcomes ?? { recordLocal, resolveLocal }}>
            <FlingButton />
          </DispatchContext.Provider>
        </LocalSessionContext.Provider>
      </FleetContext.Provider>
    </MantineProvider>,
  );
  return { ...utils, controller, recordLocal, resolveLocal };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(log.calls)) delete log.calls[k];
  state = { snapshot: snapshotAt(), position: { seconds: 120, ts: 0 } };
});

describe('FlingButton visibility', () => {
  it('shows while something plays locally and a screen exists', () => {
    renderFling();
    expect(screen.getByTestId('fling-button')).toHaveAccessibleName('Play on a screen');
  });

  it('shows for paused local playback too', () => {
    state.snapshot = snapshotAt({ playerState: 'paused' });
    renderFling();
    expect(screen.getByTestId('fling-button')).toBeInTheDocument();
  });

  it('is absent when nothing plays locally', () => {
    state.snapshot = { ...snapshotAt({ playerState: 'stopped' }), currentItem: null };
    renderFling();
    expect(screen.queryByTestId('fling-button')).toBeNull();
  });

  it('is absent when there is no screen to send to (browsers are not screens)', () => {
    renderFling({ fleetDevices: [{ id: 'browser:other', name: 'A phone' }] });
    expect(screen.queryByTestId('fling-button')).toBeNull();
  });

  it('renders nothing outside the fleet / dispatch providers', () => {
    const { container } = render(
      <LocalSessionContext.Provider value={{ controller: makeController() }}><FlingButton /></LocalSessionContext.Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FlingButton picker', () => {
  it('lists the screens, logs the open, and under 10% offers no choice and starts at 0', async () => {
    state.position = { seconds: 120, ts: 0 }; // 2% of 6000
    handOff.mockResolvedValue({ ok: true, status: 'adopted', sourceStopped: true });
    renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    expect(await screen.findByTestId('fling-target-office-tv')).toHaveTextContent('Office TV');
    expect(screen.getByTestId('fling-target-den-tv')).toBeInTheDocument();
    expect(screen.queryByTestId('fling-target-browser:other')).toBeNull();
    expect(screen.queryByTestId('fling-start-choice')).toBeNull();
    expect(log.calls.flingOpened?.[0]?.[0]).toMatchObject({ contentId: 'plex:42', targetIds: ['office-tv', 'den-tv'], offerChoice: false });

    await act(async () => { fireEvent.click(screen.getByTestId('fling-target-office-tv')); });
    expect(handOff).toHaveBeenCalledWith('office-tv', { mode: 'transfer', startAt: 0 });
    expect(log.calls.flingTargetChosen?.[0]?.[0]).toMatchObject({ targetId: 'office-tv', startMode: 'beginning', startAt: 0 });
  });

  it('past 10% offers the choice with the beginning as the default', async () => {
    state.position = { seconds: 1234, ts: 0 }; // ~20%
    handOff.mockResolvedValue({ ok: true, status: 'adopted', sourceStopped: true });
    renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    const beginning = await screen.findByTestId('fling-start-beginning');
    const current = screen.getByTestId('fling-start-current');
    expect(beginning).toHaveAttribute('aria-checked', 'true');
    expect(current).toHaveAttribute('aria-checked', 'false');
    expect(current).toHaveTextContent('Start where I am (20:34)');
    // The beginning is first.
    expect(beginning.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByTestId('fling-target-den-tv')); });
    expect(handOff).toHaveBeenCalledWith('den-tv', { mode: 'transfer', startAt: 0 });
  });

  it('"Start where I am" passes the current position', async () => {
    state.position = { seconds: 1234, ts: 0 };
    handOff.mockResolvedValue({ ok: true, status: 'adopted', sourceStopped: true });
    renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    fireEvent.click(await screen.findByTestId('fling-start-current'));
    expect(screen.getByTestId('fling-start-current')).toHaveAttribute('aria-checked', 'true');
    expect(log.calls.flingStartModeChanged?.[0]?.[0]).toMatchObject({ startMode: 'current' });
    state.position = { seconds: 1240.5, ts: 1 }; // still playing while choosing
    await act(async () => { fireEvent.click(screen.getByTestId('fling-target-office-tv')); });
    expect(handOff).toHaveBeenCalledWith('office-tv', { mode: 'transfer', startAt: 1240.5 });
    expect(log.calls.flingTargetChosen?.[0]?.[0]).toMatchObject({ startMode: 'current', startAt: 1241 });
  });

  it('on success: the hand-off stopped local playback, the picker closes, the outcome is recorded', async () => {
    handOff.mockResolvedValue({ ok: true, status: 'adopted', sourceStopped: true });
    const { recordLocal, resolveLocal } = renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    await act(async () => { fireEvent.click(await screen.findByTestId('fling-target-office-tv')); });
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'move', phase: 'running', targetId: 'office-tv', targetName: 'Office TV',
      item: { title: 'A Long Film' },
    }));
    // No contentId: the tray must not offer a plain-play Retry for a fling.
    expect(recordLocal.mock.calls[0][0].item.contentId).toBeUndefined();
    expect(resolveLocal).toHaveBeenCalledWith('attempt-1', { phase: 'confirmed' });
    expect(log.calls.flingDispatched?.[0]?.[0]).toMatchObject({ targetId: 'office-tv', contentId: 'plex:42' });
    expect(log.calls.flingLocalStopped?.[0]?.[0]).toMatchObject({ targetId: 'office-tv' });
    await waitFor(() => expect(screen.queryByTestId('fling-panel')).toBeNull());
    expect(screen.queryByTestId('fling-error')).toBeNull();
  });

  it('on failure: local keeps playing and the error is shown', async () => {
    handOff.mockResolvedValue({ ok: false, status: 'uncertain', error: 'adopt-not-observed' });
    const { controller, resolveLocal } = renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    await act(async () => { fireEvent.click(await screen.findByTestId('fling-target-office-tv')); });
    expect(controller.transport.stop).not.toHaveBeenCalled();
    expect(screen.getByTestId('fling-error')).toHaveTextContent('Office TV did not confirm. Still playing here.');
    expect(screen.getByTestId('fling-panel')).toBeInTheDocument();
    expect(resolveLocal).toHaveBeenCalledWith('attempt-1', expect.objectContaining({ phase: 'failed' }));
    expect(log.calls.flingFailed?.[0]?.[0]).toMatchObject({ targetId: 'office-tv', error: 'adopt-not-observed' });
    expect(log.calls.flingLocalStopped).toBeUndefined();
  });

  it('a thrown hand-off is a failure too, never an unhandled rejection', async () => {
    handOff.mockRejectedValue(new Error('network down'));
    renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    await act(async () => { fireEvent.click(await screen.findByTestId('fling-target-den-tv')); });
    expect(screen.getByTestId('fling-error')).toHaveTextContent('Den TV did not confirm. Still playing here.');
  });

  it('says so when the screen started but this device kept playing', async () => {
    handOff.mockResolvedValue({ ok: false, status: 'adopted', sourceStopped: false, error: 'source-changed' });
    renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    await act(async () => { fireEvent.click(await screen.findByTestId('fling-target-office-tv')); });
    expect(screen.getByTestId('fling-error')).toHaveTextContent('Started on Office TV, but this device kept playing.');
  });

  it('disables the targets while a fling is in flight', async () => {
    let finish;
    handOff.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    await act(async () => { fireEvent.click(await screen.findByTestId('fling-target-office-tv')); });
    expect(screen.getByTestId('fling-target-office-tv')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('fling-target-office-tv')).toHaveTextContent('Starting');
    expect(screen.getByTestId('fling-target-den-tv')).toHaveAttribute('aria-disabled', 'true');
    // Focus is not dropped to the page while it waits (Escape keeps working).
    expect(screen.getByTestId('fling-target-office-tv')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('fling-target-den-tv'));
    expect(handOff).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: true, status: 'adopted', sourceStopped: true }); });
  });

  it('live playback never offers the choice', async () => {
    state.snapshot = snapshotAt({ isLive: true });
    state.position = { seconds: 5000, ts: 0 };
    renderFling();
    fireEvent.click(screen.getByTestId('fling-button'));
    await screen.findByTestId('fling-target-office-tv');
    expect(screen.queryByTestId('fling-start-choice')).toBeNull();
  });
});
