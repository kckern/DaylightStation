// RELY.1a/2a/3a/5a/6a — the one outcome tray: quiet here, named + progress far.
import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const { push, retry, removeDispatch, sendElsewhere, stopAttempt, skipLocal, recordLocal } = vi.hoisted(() => ({
  recordLocal: vi.fn(), push: vi.fn(), retry: vi.fn(), removeDispatch: vi.fn(), sendElsewhere: vi.fn(), stopAttempt: vi.fn(), skipLocal: vi.fn(),
}));
const outcomes = new Map();
const DEVICES = [
  { id: 'livingroom-tv', name: 'Living Room TV', type: 'shield-tv', content_control: { type: 'fkb' } },
  { id: 'kitchen-speaker', name: 'Kitchen Speaker', type: 'speaker', content_control: { type: 'hub' } },
  { id: 'office-tv', name: 'Office TV', type: 'linux-pc', content_control: { type: 'websocket' } },
  { id: 'browser:phone', name: 'Phone', type: 'browser' },
];

vi.mock('./useDispatch.js', () => ({
  useDispatch: () => ({ dispatches: outcomes, outcomes, retry, removeDispatch, sendElsewhere, stopAttempt, skipLocal, recordLocal }),
}));
vi.mock('../fleet/useDevice.js', () => ({
  useDevice: (id) => ({ device: DEVICES.find(d => d.id === id) ?? null }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: DEVICES }) }));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push }) }));

import { MantineProvider } from '@mantine/core';
import { DispatchProgressTray } from './DispatchProgressTray.jsx';

const record = (overrides) => ({
  steps: [], playback: null, outcome: null, error: null, failedStep: null, operation: 'play-now',
  kind: 'play', distance: 'far', createdAt: '2026-10-02T00:00:00.000Z', ...overrides,
});

describe('DispatchProgressTray outcomes', () => {
  beforeEach(() => { vi.clearAllMocks(); outcomes.clear(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('names a far screen and its progress in words that fit the screen type', () => {
    outcomes.set('tv', record({ dispatchId: 'tv', attemptId: 'tv', deviceId: 'livingroom-tv', targetId: 'livingroom-tv', title: 'Arrival', status: 'running', phase: 'running', steps: [{ step: 'power', status: 'running' }] }));
    outcomes.set('spk', record({ dispatchId: 'spk', attemptId: 'spk', deviceId: 'kitchen-speaker', targetId: 'kitchen-speaker', title: 'Faith', status: 'running', phase: 'running', steps: [{ step: 'power', status: 'running' }] }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const tv = screen.getByTestId('dispatch-row-tv');
    expect(tv).toHaveTextContent('Living Room TV');
    expect(tv).toHaveTextContent('Turning on TV');
    const speaker = screen.getByTestId('dispatch-row-spk');
    expect(speaker).toHaveTextContent('Kitchen Speaker');
    expect(speaker).not.toHaveTextContent(/\bTV\b/);
  });

  it('confirms a local result quietly, names the item and this device, and clears itself', () => {
    outcomes.set('l1', record({ attemptId: 'l1', dispatchId: 'l1', targetId: 'local', deviceId: 'local', distance: 'here', phase: 'confirmed', item: { contentId: 'plex:1', title: 'Arrival' }, title: 'Arrival' }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const row = screen.getByTestId('dispatch-row-l1');
    expect(row).toHaveClass('cast-tray-row--quiet');
    expect(row).toHaveTextContent('Playing Arrival here');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(removeDispatch).toHaveBeenCalledWith('l1');
  });

  it('an unconfirmed start says it may not have started, offers Steer it and Try again, and stays', () => {
    outcomes.set('u1', record({ attemptId: 'u1', dispatchId: 'u1', targetId: 'livingroom-tv', deviceId: 'livingroom-tv', title: 'Arrival', status: 'success', outcome: 'timeout', phase: 'unconfirmed' }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const row = screen.getByTestId('dispatch-row-u1');
    expect(row).toHaveTextContent('may not have started');
    expect(row).toHaveTextContent('Living Room TV');
    expect(within(row).getByRole('button', { name: /Steer it/ })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: /Try again/ }));
    expect(retry).toHaveBeenCalledWith('u1');
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(removeDispatch).not.toHaveBeenCalledWith('u1');
  });

  it('each failure is shown separately with its own Retry and another-screen choice', () => {
    outcomes.set('f1', record({ attemptId: 'f1', dispatchId: 'f1', targetId: 'livingroom-tv', deviceId: 'livingroom-tv', title: 'Arrival', status: 'failed', phase: 'not-sent', failedStep: 'power', error: 'Device offline' }));
    outcomes.set('f2', record({ attemptId: 'f2', dispatchId: 'f2', targetId: 'office-tv', deviceId: 'office-tv', title: 'Nova', status: 'failed', phase: 'failed', failedStep: 'load', error: 'receiver rejected' }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('dispatch-row-f1')).toHaveTextContent('Not sent');
    expect(screen.getByTestId('dispatch-row-f1')).toHaveTextContent('Arrival');
    fireEvent.click(screen.getByTestId('dispatch-retry-f2'));
    expect(retry).toHaveBeenCalledWith('f2');
    fireEvent.click(screen.getByTestId('dispatch-elsewhere-f1'));
    const choices = screen.getByTestId('dispatch-elsewhere-list-f1');
    expect(within(choices).queryByText('Living Room TV')).toBeNull();
    expect(within(choices).queryByText('Phone')).toBeNull();
    fireEvent.click(within(choices).getByRole('button', { name: 'Office TV' }));
    expect(sendElsewhere).toHaveBeenCalledWith('f1', 'office-tv');
  });

  it('a local skip names the failed item, this device and what plays instead', () => {
    outcomes.set('s1', record({ attemptId: 's1', dispatchId: 's1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'playback', phase: 'skipped', reason: 'stalled', item: { contentId: 'plex:1', title: 'Arrival' }, title: 'Arrival', replacement: { contentId: 'plex:2', title: 'Nova' } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const row = screen.getByTestId('dispatch-row-s1');
    expect(row).toHaveTextContent('Arrival');
    expect(row).toHaveTextContent('this device');
    expect(row).toHaveTextContent('Now playing Nova');
    expect(row).not.toHaveClass('cast-tray-row--quiet');
    expect(screen.getByTestId('dispatch-retry-s1')).toBeInTheDocument();
  });

  it('announces outcome text through one live region', () => {
    outcomes.set('u1', record({ attemptId: 'u1', dispatchId: 'u1', targetId: 'livingroom-tv', deviceId: 'livingroom-tv', title: 'Arrival', status: 'success', outcome: 'timeout', phase: 'unconfirmed' }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const live = screen.getByTestId('media-outcome-announcer');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('may not have started');
  });

  it('offers Undo on the outcome itself while the undo window is open', () => {
    const undo = vi.fn(() => ({ ok: true }));
    outcomes.set('q1', record({ attemptId: 'q1', dispatchId: 'q1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'remove', phase: 'confirmed', item: { title: 'Remove item' }, title: 'Remove item', undo: { operationId: 'op-1', expiresAt: Date.now() + 10_000, run: undo } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    fireEvent.click(screen.getByTestId('item-action-undo'));
    expect(undo).toHaveBeenCalledWith('op-1');
  });

  it('RELY.1a/AC1: undoing a removal records its own confirmation naming the item and the screen', async () => {
    const undo = vi.fn(() => ({ ok: true }));
    outcomes.set('q2', record({ attemptId: 'q2', dispatchId: 'q2', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'remove', phase: 'confirmed', item: { contentId: 'plex:1', title: 'Hospital' }, title: 'Hospital', undo: { operationId: 'op-2', expiresAt: Date.now() + 10_000, run: undo } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    await act(async () => { fireEvent.click(screen.getByTestId('item-action-undo')); });
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'undo', phase: 'confirmed', item: expect.objectContaining({ title: 'Hospital' }) }));
  });

  it('the put-back confirmation reads "Put back <item> here"; undoing an add reads "Took back"', () => {
    outcomes.set('p1', record({ attemptId: 'p1', dispatchId: 'p1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'undo', phase: 'confirmed', item: { title: 'Hospital' }, title: 'Hospital', command: { undid: 'remove' } }));
    outcomes.set('p2', record({ attemptId: 'p2', dispatchId: 'p2', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'undo', phase: 'confirmed', item: { title: 'Arrival' }, title: 'Arrival', command: { undid: 'add' } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('dispatch-row-p1')).toHaveTextContent('Put back Hospital here');
    expect(screen.getByTestId('dispatch-row-p2')).toHaveTextContent('Took back Arrival here');
  });

  it('undoing a Clear says the queue was put back, not an item', () => {
    outcomes.set('p3', record({ attemptId: 'p3', dispatchId: 'p3', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'undo', phase: 'confirmed', item: { title: 'what was playing' }, title: 'what was playing', command: { undid: 'clear' } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('dispatch-row-p3')).toHaveTextContent('Put the queue back here');
  });

  it('PLAY.2a/AC3, PLAY.7a/AC2: a whole collection states how many items, here and on a screen', () => {
    outcomes.set('c1', record({ attemptId: 'c1', dispatchId: 'c1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'add', phase: 'confirmed', count: 6, item: { title: 'Baby Joy Joy' }, title: 'Baby Joy Joy' }));
    outcomes.set('c2', record({ attemptId: 'c2', dispatchId: 'c2', targetId: 'livingroom-tv', deviceId: 'livingroom-tv', title: 'Baby Joy Joy', kind: 'add', operation: 'add', status: 'success', outcome: 'confirmed', phase: 'confirmed', outcomeIdentity: { count: 6, queueLength: 6, ordinal: 1 } }));
    outcomes.set('c3', record({ attemptId: 'c3', dispatchId: 'c3', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'add', phase: 'confirmed', count: 1, item: { title: 'Arrival' }, title: 'Arrival' }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('dispatch-row-c1')).toHaveTextContent('Added Baby Joy Joy (6 items) here');
    expect(screen.getByTestId('dispatch-row-c2')).toHaveTextContent('Added Baby Joy Joy (6 items) to Living Room TV');
    expect(screen.getByTestId('dispatch-row-c3')).toHaveTextContent('Added Arrival here');
    expect(screen.getByTestId('dispatch-row-c3')).not.toHaveTextContent('items');
  });

  it('PLACE.7a/AC3: Move here names the screen it came from', () => {
    outcomes.set('m1', record({ attemptId: 'm1', dispatchId: 'm1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'moveHere', phase: 'confirmed', item: { title: 'Hospital' }, title: 'Hospital', command: { sourceName: 'Living Room TV' } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('dispatch-row-m1')).toHaveTextContent('Moved Hospital here from Living Room TV');
  });

  it('PLACE.7a/AC3: a Move from another screen says it moved here, from where', () => {
    outcomes.set('m2', record({ attemptId: 'm2', dispatchId: 'm2', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'move', phase: 'confirmed', item: { title: 'Hospital' }, title: 'Hospital', command: { sourceName: 'Kitchen' } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('dispatch-row-m2')).toHaveTextContent('Moved Hospital here from Kitchen');
  });

  it('O1: a far start still in progress offers Undo inside its window, then Stop (queue kept) after it expires', () => {
    outcomes.set('w1', record({ attemptId: 'w1', dispatchId: 'w1', targetId: 'office-tv', deviceId: 'office-tv', title: 'Arrival', status: 'running', phase: 'running',
      steps: [{ step: 'power', status: 'running' }],
      undo: { operationId: 'op-w1', expiresAt: Date.now() + 10_000, run: vi.fn() } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('item-action-undo')).toBeInTheDocument();
    expect(screen.queryByTestId('dispatch-stop-w1')).toBeNull();
    act(() => { vi.advanceTimersByTime(10_500); });
    expect(screen.queryByTestId('item-action-undo')).toBeNull();
    const stop = screen.getByTestId('dispatch-stop-w1');
    expect(stop).toHaveAccessibleName(/Stop/);
    fireEvent.click(stop);
    expect(stopAttempt).toHaveBeenCalledWith('w1');
  });

  it('a plain far send in progress can be stopped from this device', () => {
    outcomes.set('s2', record({ attemptId: 's2', dispatchId: 's2', targetId: 'livingroom-tv', deviceId: 'livingroom-tv', title: 'Arrival', status: 'success', phase: 'sent' }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    fireEvent.click(screen.getByTestId('dispatch-stop-s2'));
    expect(stopAttempt).toHaveBeenCalledWith('s2');
  });

  it('RELY.5a: a refused file shows "Waiting for … being repaired" with Skip now and Retry', () => {
    outcomes.set('w1', record({ attemptId: 'w1', dispatchId: 'w1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'playback', phase: 'waiting', reason: 'source-unavailable', item: { contentId: 'plex:1', title: 'Arrival' }, title: 'Arrival', command: { kind: 'playNow', item: { contentId: 'plex:1', title: 'Arrival' } } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const row = screen.getByTestId('dispatch-row-w1');
    expect(row).toHaveTextContent('Waiting for Arrival — the file is being repaired');
    expect(row).not.toHaveClass('cast-tray-row--quiet');
    fireEvent.click(screen.getByTestId('dispatch-skip-w1'));
    expect(skipLocal).toHaveBeenCalledWith('w1');
    expect(screen.getByTestId('dispatch-retry-w1')).toBeInTheDocument();
  });

  it('a remote screen\'s held video names that screen, never "this device"', () => {
    outcomes.set('w2', record({ attemptId: 'w2', dispatchId: 'w2', targetId: 'livingroom-tv', targetName: 'Living Room TV', deviceId: 'livingroom-tv', distance: 'direct', kind: 'playback', phase: 'waiting', reason: 'source-unavailable', item: { contentId: 'plex:1', title: 'Arrival' }, title: 'Arrival', command: { kind: 'playNow', item: { contentId: 'plex:1' } } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const row = screen.getByTestId('dispatch-row-w2');
    expect(row).toHaveTextContent('On Living Room TV');
    expect(row).not.toHaveTextContent('this device');
  });

  it('RELY.5a/AC4: a skip a steered screen reported names that screen, not this device', () => {
    outcomes.set('r1', record({ attemptId: 'r1', dispatchId: 'r1', targetId: 'livingroom-tv', targetName: 'Living Room TV', deviceId: 'livingroom-tv', distance: 'direct', kind: 'playback', phase: 'skipped', reason: 'stalled', item: { contentId: 'plex:1', title: 'Arrival' }, title: 'Arrival', replacement: { contentId: 'plex:2', title: 'Nova' }, command: { kind: 'playNow', item: { contentId: 'plex:1' } } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const row = screen.getByTestId('dispatch-row-r1');
    expect(row).toHaveTextContent('Arrival stopped making progress on Living Room TV');
    expect(row).toHaveTextContent('Now playing Nova');
    expect(row).not.toHaveTextContent('this device');
  });

  it('RELY.5a: an unavailable file reads "skipped — file unavailable" with what plays next', () => {
    outcomes.set('u1', record({ attemptId: 'u1', dispatchId: 'u1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'playback', phase: 'skipped', reason: 'file-unavailable', item: { contentId: 'plex:1', title: 'Arrival' }, title: 'Arrival', replacement: { contentId: 'plex:2', title: 'Nova' }, command: { kind: 'playNow', item: { contentId: 'plex:1' } } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const row = screen.getByTestId('dispatch-row-u1');
    expect(row).toHaveTextContent('Arrival skipped — file unavailable');
    expect(row).toHaveTextContent('Now playing Nova');
    expect(screen.getByTestId('dispatch-retry-u1')).toBeInTheDocument();
  });

  it('RELY.5a: a library outage holds with one "Library unavailable" notice', () => {
    outcomes.set('l1', record({ attemptId: 'l1', dispatchId: 'l1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'playback', phase: 'library-unavailable', reason: 'source-unavailable', item: { contentId: 'plex:2', title: 'Nova' }, title: 'Nova', command: { kind: 'playNow', item: { contentId: 'plex:2' } } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('dispatch-row-l1')).toHaveTextContent('Library unavailable');
    expect(screen.getByTestId('dispatch-skip-l1')).toBeInTheDocument();
  });

  it('PLAY.10a: a Play the screen took as an add says so, with its place in line', () => {
    outcomes.set('ao', record({ dispatchId: 'ao', attemptId: 'ao', deviceId: 'livingroom-tv', targetId: 'livingroom-tv', title: 'Faith',
      kind: 'add', operation: 'add', appliedAs: 'add', status: 'success', phase: 'confirmed', outcome: 'confirmed',
      outcomeIdentity: { queueLength: 5, ordinal: 5 } }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const tray = screen.getByTestId('dispatch-tray');
    expect(tray).toHaveTextContent('Added Faith to Living Room TV (Add only is on)');
    expect(tray).toHaveTextContent('5th in line');
  });
});
