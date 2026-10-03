// The session controls row is the SAME for this device and another screen
// (STEER.1b): sleep timer (STEER.10a), Stop after this one + countdown
// (STEER.13b), Add only (PLAY.10a), notes with Put it back (RELY.4b), and the
// end-of-queue choice at the bottom of the queue (STEER.13a).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { PeekContext } from '../peek/PeekContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { createRemoteSessionController } from '../peek/RemoteSessionController.js';
import { createFleetStore } from '../fleet/fleetStore.js';
import { createAckRouter } from '../peek/ackRouter.js';
import { SessionControlsPanel } from './SessionControlsPanel.jsx';
import { EndOfQueueChoice } from './EndOfQueueChoice.jsx';
import { MiniPlayer } from './MiniPlayer.jsx';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ push: vi.fn(), view: 'home' }) }));
vi.mock('../session/usePlayerHost.js', () => ({ usePlayerHost: () => {} }));

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

function localSetup() {
  const controller = createLocalSessionController({
    clientId: 'ui', sessionControls: { storage: memoryStorage(), resolveContinuation: async () => [] },
  });
  controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
  return controller;
}

function remoteSetup(controls, snapshotExtra = {}) {
  const fleetStore = createFleetStore();
  const ackRouter = createAckRouter();
  const http = vi.fn(async () => ({ ok: true }));
  let n = 0;
  const ctl = createRemoteSessionController({ deviceId: 'tv', fleetStore, ackRouter, http, randomUuid: () => `cmd-${++n}` });
  const publish = (nextControls) => fleetStore.receive({
    deviceId: 'tv',
    snapshot: {
      sessionId: 's', state: 'playing', position: 30,
      currentItem: { contentId: 'plex:1', title: 'Hospital', duration: 420 },
      queue: { items: [{ queueItemId: 'q1', contentId: 'plex:1', title: 'Hospital' }], currentIndex: 0, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', volume: 50 },
      ...(nextControls ? { controls: nextControls } : {}),
      ...snapshotExtra,
    },
    reason: 'change', ts: new Date().toISOString(),
  });
  publish(controls);
  return { ctl, http, ackRouter, publish };
}

function Providers({ local, remote, outcomes, children }) {
  return (
    <MantineProvider>
      <DispatchContext.Provider value={outcomes}>
        <LocalSessionContext.Provider value={{ controller: local }}>
          <PeekContext.Provider value={{ getController: () => remote ?? null }}>
            {children}
          </PeekContext.Provider>
        </LocalSessionContext.Provider>
      </DispatchContext.Provider>
    </MantineProvider>
  );
}

const baseControls = {
  addOnly: false, endOfQueue: 'stop', stopAfterCurrent: false, sleepTimer: null, sleepResume: null,
  countdown: null, endOfQueueStatus: null, notes: [],
};

let outcomes;
beforeEach(() => { outcomes = { recordLocal: vi.fn(() => 'a1'), resolveLocal: vi.fn() }; });
afterEach(() => { vi.useRealTimers(); });

describe('SessionControlsPanel — this device', () => {
  it('sets a sleep timer from the menu and shows the time left on the controls and the handle', async () => {
    const local = localSetup();
    local.queue.playNow({ contentId: 'plex:a', title: 'Audiobook', format: 'audio', duration: 3600 });
    render(<Providers local={local} outcomes={outcomes}><SessionControlsPanel target="local" /><MiniPlayer /></Providers>);
    fireEvent.click(screen.getByTestId('sleep-timer-button'));
    fireEvent.click(await screen.findByTestId('sleep-option-30'));
    await waitFor(() => expect(screen.getByTestId('sleep-timer-left').textContent).toMatch(/^Sleep in (30:00|29:5\d)$/));
    expect(screen.getByTestId('mini-sleep').getAttribute('aria-label')).toMatch(/^Sleep timer: (30:00|29:5\d) left$/);
    expect(screen.getByTestId('sleep-timer-button').getAttribute('aria-pressed')).toBe('true');
  });

  it('offers the end of this item, and turning the timer off', async () => {
    const local = localSetup();
    local.queue.playNow({ contentId: 'plex:a', title: 'Ep', format: 'video', type: 'episode', duration: 600 });
    render(<Providers local={local} outcomes={outcomes}><SessionControlsPanel target="local" /><MiniPlayer /></Providers>);
    fireEvent.click(screen.getByTestId('sleep-timer-button'));
    fireEvent.click(await screen.findByTestId('sleep-option-end'));
    await waitFor(() => expect(screen.getByTestId('sleep-timer-left').textContent).toBe('Sleep at end of this item'));
    expect(screen.getByTestId('mini-sleep').textContent).toMatch(/end/);
    fireEvent.click(screen.getByTestId('sleep-timer-button'));
    fireEvent.click(await screen.findByTestId('sleep-option-off'));
    await waitFor(() => expect(screen.queryByTestId('mini-sleep')).toBeNull());
  });

  it('after the timer stops, offers both where it stopped and where the timer was set', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const local = localSetup();
    local.queue.playNow({ contentId: 'plex:a', title: 'Audiobook', format: 'audio', duration: 3600 });
    local.store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    local.onPlayerPositionTick(120, 'plex:a');
    render(<Providers local={local} outcomes={outcomes}><SessionControlsPanel target="local" /></Providers>);
    await act(async () => { await local.sessionControls.setSleepTimer({ minutes: 15 }); });
    await act(async () => {
      local.onPlayerPositionTick(900, 'plex:a');
      vi.advanceTimersByTime(15 * 60_000);
    });
    const offer = await screen.findByTestId('sleep-resume');
    expect(within(offer).getByTestId('sleep-continue-set').textContent).toBe('Continue from 2:00, where the timer was set');
    expect(within(offer).getByTestId('sleep-continue-stopped').textContent).toBe('Continue where it stopped (15:00)');
    await act(async () => { fireEvent.click(within(offer).getByTestId('sleep-continue-set')); });
    await waitFor(() => expect(local.getSnapshot().position).toBe(120));
    expect(screen.queryByTestId('sleep-resume')).toBeNull();
  });

  it('Stop after this one is one step and shows it is on', async () => {
    const local = localSetup();
    local.queue.playNow({ contentId: 'plex:a', title: 'Ep', format: 'video', duration: 600 });
    render(<Providers local={local} outcomes={outcomes}><SessionControlsPanel target="local" /></Providers>);
    const toggle = screen.getByTestId('stop-after-current');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(screen.getByTestId('stop-after-current').getAttribute('aria-pressed')).toBe('true'));
    expect(local.sessionControls.getState().stopAfterCurrent).toBe(true);
  });

  it('the countdown is visible and cancellable', async () => {
    const local = localSetup();
    local.queue.playNow({ contentId: 'plex:e1', title: 'Hospital', format: 'video', type: 'episode', duration: 420 });
    local.queue.add({ contentId: 'plex:e2', title: 'Keepy Uppy', format: 'video', type: 'episode', duration: 420 });
    render(<Providers local={local} outcomes={outcomes}><SessionControlsPanel target="local" /></Providers>);
    act(() => { local.onPlayerEnded('plex:e1'); });
    const banner = await screen.findByTestId('countdown-banner');
    expect(banner.textContent).toMatch(/Next: Keepy Uppy in 1?\ds/);
    await act(async () => { fireEvent.click(screen.getByTestId('countdown-cancel')); });
    await waitFor(() => expect(screen.queryByTestId('countdown-banner')).toBeNull());
    expect(local.getSnapshot().currentItem.contentId).toBe('plex:e1');
  });

  it('shows no Add only toggle for this device (a screen setting)', () => {
    const local = localSetup();
    local.queue.playNow({ contentId: 'plex:a', title: 'A', format: 'audio', duration: 60 });
    render(<Providers local={local} outcomes={outcomes}><SessionControlsPanel target="local" /></Providers>);
    expect(screen.queryByTestId('add-only-toggle')).toBeNull();
  });
});

describe('SessionControlsPanel — another screen (same controls, same layout)', () => {
  it('Add only is one step, sent to that screen, and shown from what it publishes', async () => {
    const local = localSetup();
    const { ctl, http, ackRouter, publish } = remoteSetup(baseControls);
    render(<Providers local={local} remote={ctl} outcomes={outcomes}><SessionControlsPanel target={{ deviceId: 'tv' }} targetName="Living Room TV" /></Providers>);
    const toggle = screen.getByTestId('add-only-toggle');
    expect(toggle.textContent).toBe('Add only: off');
    await act(async () => { fireEvent.click(toggle); });
    expect(http).toHaveBeenCalledWith('api/v1/device/tv/session/add-only', expect.objectContaining({ enabled: true }), 'PUT');
    await act(async () => {
      ackRouter.resolve({ commandId: 'cmd-1', ok: true });
      publish({ ...baseControls, addOnly: true });
    });
    await waitFor(() => expect(screen.getByTestId('add-only-toggle').textContent).toBe('Add only: on'));
    expect(screen.getByTestId('add-only-hint').textContent).toMatch(/added to this queue instead of replacing/);
  });

  it('a refused command becomes an outcome naming the screen', async () => {
    const local = localSetup();
    const { ctl, ackRouter } = remoteSetup(baseControls);
    render(<Providers local={local} remote={ctl} outcomes={outcomes}><SessionControlsPanel target={{ deviceId: 'tv' }} targetName="Living Room TV" /></Providers>);
    await act(async () => { fireEvent.click(screen.getByTestId('stop-after-current')); });
    await act(async () => { ackRouter.resolve({ commandId: 'cmd-1', ok: false, code: 'DEVICE_OFFLINE', error: 'offline' }); });
    await waitFor(() => expect(outcomes.recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'control', phase: 'failed', targetId: 'tv', targetName: 'Living Room TV', item: { title: 'Stop after this one' },
    })));
  });

  it('shows the screen notes with Put it back while it can, and puts it back', async () => {
    const local = localSetup();
    const until = new Date(Date.now() + 8000).toISOString();
    const { ctl, http, ackRouter } = remoteSetup({
      ...baseControls,
      notes: [{ id: 'n1', kind: 'paused', label: "Paused by Dad's phone", count: 2, at: new Date().toISOString(), origin: null, putBack: { availableUntil: until } },
        { id: 'n0', kind: 'stopped', label: 'Stopped by Kitchen', count: 1, at: new Date(Date.now() - 120000).toISOString(), origin: null, putBack: null }],
    });
    render(<Providers local={local} remote={ctl} outcomes={outcomes}><SessionControlsPanel target={{ deviceId: 'tv' }} targetName="Living Room TV" /></Providers>);
    const notes = screen.getByTestId('screen-notes');
    expect(within(notes).getAllByTestId('remote-note-label').map((n) => n.textContent)).toEqual(["Paused by Dad's phone", 'Stopped by Kitchen']);
    expect(within(screen.getByTestId('screen-note-n1')).getByText(/\(2×\)/)).toBeTruthy();
    expect(within(screen.getByTestId('screen-note-n0')).queryByTestId('remote-note-put-back')).toBeNull();
    await act(async () => { fireEvent.click(within(screen.getByTestId('screen-note-n1')).getByTestId('remote-note-put-back')); });
    expect(http).toHaveBeenCalledWith('api/v1/device/tv/session/put-back', expect.objectContaining({ noteId: 'n1' }), 'POST');
    await act(async () => { ackRouter.resolve({ commandId: 'cmd-1', ok: true }); });
    await waitFor(() => expect(outcomes.recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'undo', phase: 'confirmed', targetId: 'tv', item: { title: 'what was playing' },
    })));
  });

  it('a screen that cannot report controls shows them unavailable with a reason, not missing', () => {
    const local = localSetup();
    const { ctl } = remoteSetup(null);
    render(<Providers local={local} remote={ctl} outcomes={outcomes}><SessionControlsPanel target={{ deviceId: 'tv' }} /></Providers>);
    expect(screen.getByTestId('sleep-timer-button').disabled).toBe(true);
    expect(screen.getByTestId('add-only-toggle').disabled).toBe(true);
    expect(screen.getByTestId('session-controls-unavailable').textContent).toMatch(/not reported its session controls/);
  });

  it('cancels and starts a remote countdown', async () => {
    const local = localSetup();
    const endsAt = new Date(Date.now() + 7000).toISOString();
    const { ctl, http } = remoteSetup({ ...baseControls, countdown: { seconds: 10, endsAt, remainingSeconds: 7, next: { contentId: 'plex:2', title: 'Keepy Uppy', queueItemId: 'q2' }, current: { contentId: 'plex:1', title: 'Hospital' } } });
    render(<Providers local={local} remote={ctl} outcomes={outcomes}><SessionControlsPanel target={{ deviceId: 'tv' }} /></Providers>);
    expect(screen.getByTestId('countdown-banner').textContent).toMatch(/Next: Keepy Uppy in [67]s/);
    await act(async () => { fireEvent.click(screen.getByTestId('countdown-cancel')); });
    expect(http).toHaveBeenCalledWith('api/v1/device/tv/session/countdown/cancel', expect.any(Object), 'POST');
  });
});

describe('EndOfQueueChoice (STEER.13a)', () => {
  it('shows the current choice and changes it in one step, here and on a screen', async () => {
    const local = localSetup();
    local.queue.playNow({ contentId: 'plex:a', title: 'A', format: 'audio', duration: 60 });
    const { ctl, http } = remoteSetup({ ...baseControls, endOfQueue: 'repeat', endOfQueueStatus: { code: 'NOTHING_SIMILAR', message: 'Nothing similar left', at: new Date().toISOString() } });
    render(<Providers local={local} remote={ctl} outcomes={outcomes}>
      <div data-testid="here"><EndOfQueueChoice target="local" /></div>
      <div data-testid="there"><EndOfQueueChoice target={{ deviceId: 'tv' }} /></div>
    </Providers>);
    const here = screen.getByTestId('here');
    expect(within(here).getByTestId('queue-end-stop').getAttribute('aria-checked')).toBe('true');
    await act(async () => { fireEvent.click(within(here).getByTestId('queue-end-similar')); });
    await waitFor(() => expect(within(here).getByTestId('queue-end-similar').getAttribute('aria-checked')).toBe('true'));
    const there = screen.getByTestId('there');
    expect(within(there).getByTestId('queue-end-repeat').getAttribute('aria-checked')).toBe('true');
    expect(within(there).getByTestId('queue-end-status').textContent).toBe('Nothing similar left');
    await act(async () => { fireEvent.click(within(there).getByTestId('queue-end-similar')); });
    expect(http).toHaveBeenCalledWith('api/v1/device/tv/session/end-of-queue', expect.objectContaining({ mode: 'similar' }), 'PUT');
  });
});
