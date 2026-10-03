import { render, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { getActionBus, resetActionBus } from '../input/ActionBus.js';
import { ScreenVolumeProvider } from '../providers/ScreenVolumeProvider.jsx';
import { _resetForTests as resetVolume } from '../../lib/volume/ScreenVolumeContext.js';
import { getNaturalEndPolicy } from '../../modules/Player/lib/naturalEndPolicy.js';
import { createScreenSessionControls } from './screenSessionControls.js';
import { ScreenSessionControlsHost } from './ScreenSessionControlsHost.jsx';
import { savePersistedSession, loadPersistedSession, restorableSnapshot, POWER_RESTORE_DELAY_MS } from './sessionPersistence.js';

const playing = {
  sessionId: 's', state: 'playing', position: 77,
  currentItem: { contentId: 'plex:1', queueItemId: 'q1', format: 'video', title: 'One' },
  queue: { items: [{ contentId: 'plex:1', queueItemId: 'q1', format: 'video' }], currentIndex: 0, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'tv', updatedAt: 'x', playbackOwner: { ownerInstanceId: 'p' } },
};
const idle = { ...playing, state: 'idle', currentItem: null, queue: { items: [], currentIndex: -1, upNextCount: 0 } };

function makeSource(initial) {
  let snap = initial;
  const listeners = new Set();
  return {
    ownerId: 'tv',
    getActionOwner: () => (snap?.currentItem ? { ownerInstanceId: 'bound-player' } : null),
    getBareSnapshot: () => snap,
    getSnapshot: () => snap,
    subscribe: ({ onChange }) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    set(next) { snap = next; for (const fn of listeners) fn(); },
  };
}

function mount(source, controls = createScreenSessionControls({ ownerId: 'tv' })) {
  const view = render(
    <ScreenVolumeProvider defaultMaster={1}>
      <ScreenSessionControlsHost controls={controls} source={source} />
    </ScreenVolumeProvider>,
  );
  return { controls, view };
}

beforeEach(() => { resetActionBus(); resetVolume(); window.localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('session persistence (power cut, RQ-RELY-08)', () => {
  it('keeps only a restorable snapshot, without owner proof', () => {
    expect(restorableSnapshot(idle)).toBeNull();
    expect(restorableSnapshot({ ...playing, currentItem: { ...playing.currentItem, isLive: true } })).toBeNull();
    expect(restorableSnapshot(playing).meta).not.toHaveProperty('playbackOwner');
  });

  it('round-trips and expires the snapshot after a day but keeps the modes', () => {
    savePersistedSession('tv', playing, { addOnly: true }, { now: Date.parse('2026-10-01T00:00:00Z') });
    expect(loadPersistedSession('tv', Date.parse('2026-10-01T01:00:00Z')).snapshot).toMatchObject({ position: 77 });
    const old = loadPersistedSession('tv', Date.parse('2026-10-03T00:00:00Z'));
    expect(old.snapshot).toBeNull();
    expect(old.modes).toEqual({ addOnly: true });
  });
});

describe('ScreenSessionControlsHost', () => {
  it('re-adopts the persisted session PAUSED on cold start and restores the modes', async () => {
    savePersistedSession('tv', playing, { addOnly: true, endOfQueue: 'repeat', stopAfterCurrent: false });
    const restores = [];
    getActionBus().subscribe('media:restore-snapshot', (p) => {
      restores.push(p);
      getActionBus().emit('media:restore-snapshot-result', { requestId: p.requestId, ok: true });
    });
    const { controls } = mount(makeSource(idle));
    await act(async () => { vi.advanceTimersByTime(POWER_RESTORE_DELAY_MS + 10); });
    expect(controls.toPublished()).toMatchObject({ addOnly: true, endOfQueue: 'repeat' });
    expect(restores).toHaveLength(1);
    expect(restores[0]).toMatchObject({ autoplay: false, reason: 'power-restore', snapshot: { state: 'paused', position: 77 } });
  });

  it('does not restore over playback that already started', async () => {
    savePersistedSession('tv', playing, null);
    const restore = vi.fn();
    getActionBus().subscribe('media:restore-snapshot', restore);
    mount(makeSource({ ...playing, currentItem: { ...playing.currentItem, contentId: 'plex:new' } }));
    await act(async () => { vi.advanceTimersByTime(POWER_RESTORE_DELAY_MS + 10); });
    expect(restore).not.toHaveBeenCalled();
  });

  it('persists the live session once the restore phase is over', async () => {
    const source = makeSource(idle);
    mount(source);
    await act(async () => { vi.advanceTimersByTime(POWER_RESTORE_DELAY_MS + 10); });
    act(() => source.set(playing));
    await act(async () => { vi.advanceTimersByTime(2_100); });
    expect(loadPersistedSession('tv').snapshot).toMatchObject({ currentItem: { contentId: 'plex:1' }, position: 77 });
  });

  it('keeps the persisted spot fresh while playing, without any state change', async () => {
    const source = makeSource(idle);
    mount(source);
    await act(async () => { vi.advanceTimersByTime(POWER_RESTORE_DELAY_MS + 10); });
    act(() => source.set(playing));
    await act(async () => { vi.advanceTimersByTime(2_100); });
    const snap = { ...playing, position: 300 };
    source.getBareSnapshot = () => snap; // position ticks are not change events
    await act(async () => { vi.advanceTimersByTime(5_100); });
    expect(loadPersistedSession('tv').snapshot.position).toBe(300);
  });

  it('answers session-control commands with applied / error acks', async () => {
    mount(makeSource(playing));
    const applied = vi.fn();
    const failed = vi.fn();
    getActionBus().subscribe('media:session-control-applied', applied);
    getActionBus().subscribe('command-handler-error', failed);
    await act(async () => { getActionBus().emit('media:session-control', { kind: 'config', setting: 'addOnly', value: true, commandId: 'k1' }); });
    expect(applied).toHaveBeenCalledWith({ commandId: 'k1' });
    await act(async () => { getActionBus().emit('media:session-control', { kind: 'session', action: 'put-back', params: {}, commandId: 'p1' }); });
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'p1', code: 'PUT_BACK_UNAVAILABLE' }));
  });

  it('registers the natural-end policy for the bound owner only, while mounted', () => {
    const { view } = mount(makeSource(playing));
    expect(getNaturalEndPolicy('bound-player')).toBeTypeOf('function');
    expect(getNaturalEndPolicy('school-lesson-player')).toBeNull();
    view.unmount();
    expect(getNaturalEndPolicy('bound-player')).toBeNull();
  });

  it('shows a screen note with Put it back, and the button restores', async () => {
    const restore = vi.fn((p) => getActionBus().emit('media:restore-snapshot-result', { requestId: p.requestId, ok: true }));
    getActionBus().subscribe('media:restore-snapshot', restore);
    const { controls, view } = mount(makeSource(playing));
    act(() => { controls.noteRemoteCommand({ command: 'transport', params: { action: 'stop' }, origin: { kind: 'routine', name: 'Bedtime' } }); });
    expect(view.getByTestId('screen-note-label').textContent).toBe('Stopped by Bedtime');
    await act(async () => { fireEvent.click(view.getByTestId('screen-note-put-back')); });
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ reason: 'put-back', autoplay: true }));
    await act(async () => { await Promise.resolve(); });
    expect(view.queryByTestId('screen-note-put-back')).toBeNull();
  });

  it('a transport command on the bus interrupts a countdown (B4)', () => {
    const { controls, view } = mount(makeSource(playing));
    const actions = { advance: vi.fn(), stop: vi.fn(), finish: vi.fn(), restartQueue: vi.fn() };
    const ep = (n) => ({ contentId: `plex:${n}`, title: `Ep ${n}`, type: 'episode' });
    act(() => { controls.naturalEndPolicy({ isQueue: true, current: ep(1), next: ep(2) }, actions); });
    act(() => { getActionBus().emit('media:playback', { command: 'skipNext', commandId: 'c1' }); });
    expect(view.queryByTestId('screen-next-countdown')).toBeNull();
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(actions.advance).not.toHaveBeenCalled();
  });

  it('renders a cancellable countdown and lets Back cancel it', async () => {
    const { controls, view } = mount(makeSource(playing));
    const actions = { advance: vi.fn(), stop: vi.fn(), finish: vi.fn(), restartQueue: vi.fn() };
    const ep = (n) => ({ contentId: `plex:${n}`, title: `Ep ${n}`, type: 'episode' });
    act(() => { controls.naturalEndPolicy({ isQueue: true, current: ep(1), next: ep(2) }, actions); });
    expect(view.getByTestId('screen-next-countdown').textContent).toContain('Ep 2');
    expect(view.getByTestId('screen-next-countdown-seconds').textContent).toBe('10');
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(view.getByTestId('screen-next-countdown-seconds').textContent).toBe('7');
    act(() => { getActionBus().emit('escape', {}); });
    expect(actions.stop).toHaveBeenCalled();
    expect(view.queryByTestId('screen-next-countdown')).toBeNull();
  });
});
