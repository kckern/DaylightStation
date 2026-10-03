// Power-cut restore must never resurrect a session nobody wants (review B2/B3/B5).
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { getActionBus, resetActionBus } from '../input/ActionBus.js';
import { ScreenVolumeProvider } from '../providers/ScreenVolumeProvider.jsx';
import { _resetForTests as resetVolume } from '../../lib/volume/ScreenVolumeContext.js';
import { createScreenSessionControls } from './screenSessionControls.js';
import { ScreenSessionControlsHost } from './ScreenSessionControlsHost.jsx';
import {
  savePersistedSession, loadPersistedSession, restorableSnapshot, POWER_RESTORE_DELAY_MS, SESSION_STORAGE_PREFIX,
} from './sessionPersistence.js';

const item = { contentId: 'plex:1', queueItemId: 'q1', format: 'video', title: 'One' };
const playing = {
  sessionId: 's', state: 'playing', position: 77, currentItem: item,
  queue: { items: [item, { contentId: 'plex:2', queueItemId: 'q2', format: 'video' }], currentIndex: 0, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'tv', updatedAt: 'x' },
};
const stopped = { ...playing, state: 'ready', position: 0 };
const idle = { ...playing, state: 'idle', currentItem: null, queue: { items: [], currentIndex: -1, upNextCount: 0 } };

function makeSource(initial, { owner = null } = {}) {
  let snap = initial;
  const listeners = new Set();
  return {
    ownerId: 'tv',
    getActionOwner: () => owner,
    getBareSnapshot: () => snap,
    getSnapshot: () => snap,
    subscribe: ({ onChange }) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    set(next) { snap = next; for (const fn of listeners) fn(); },
  };
}

function mount(source) {
  const controls = createScreenSessionControls({ ownerId: 'tv' });
  const view = render(
    <ScreenVolumeProvider defaultMaster={1}>
      <ScreenSessionControlsHost controls={controls} source={source} />
    </ScreenVolumeProvider>,
  );
  return { controls, view };
}

function answerRestores() {
  const restores = [];
  getActionBus().subscribe('media:restore-snapshot', (p) => {
    restores.push(p);
    getActionBus().emit('media:restore-snapshot-result', { requestId: p.requestId, ok: true });
  });
  return restores;
}

const pastRestore = async () => { await act(async () => { vi.advanceTimersByTime(POWER_RESTORE_DELAY_MS + 10); }); };

beforeEach(() => {
  resetActionBus(); resetVolume(); window.localStorage.clear(); vi.useFakeTimers();
  window.history.replaceState(null, '', '/screen/living-room');
});
afterEach(() => { vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

describe('B2 — restore never races a start that is already under way', () => {
  it('bails when the page URL carries autoplay parameters (kitchen button / URL load)', async () => {
    savePersistedSession('tv', playing, null);
    window.history.replaceState(null, '', '/screen/living-room?queue=plex:999');
    const restores = answerRestores();
    mount(makeSource(idle));
    await pastRestore();
    expect(restores).toHaveLength(0);
  });

  it('bails when any start reached the screen after mount (WS dispatch, local input)', async () => {
    for (const event of ['media:queue-op', 'media:play', 'media:queue', 'media:adopt-snapshot']) {
      resetActionBus();
      savePersistedSession('tv', playing, null);
      const restores = answerRestores();
      const { view } = mount(makeSource(idle));
      act(() => { getActionBus().emit(event, { op: 'play-now', contentId: 'plex:9', commandId: 'c' }); });
      await pastRestore();
      expect(restores, event).toHaveLength(0);
      view.unmount();
    }
  });

  it('bails when a playback owner is already registered', async () => {
    savePersistedSession('tv', playing, null);
    const restores = answerRestores();
    mount(makeSource(idle, { owner: { ownerInstanceId: 'p' } }));
    await pastRestore();
    expect(restores).toHaveLength(0);
  });
});

describe('B3 — a stopped, moved or already-offered session is never resurrected', () => {
  it('does not persist a stopped (ready) session', () => {
    expect(restorableSnapshot(stopped)).toBeNull();
  });

  it('Stop (or Move here, which stops this screen) clears the record, so a reload restores nothing', async () => {
    const source = makeSource(idle);
    const first = mount(source);
    await pastRestore();
    act(() => source.set(playing));
    await act(async () => { vi.advanceTimersByTime(2_100); });
    expect(loadPersistedSession('tv')?.snapshot).toBeTruthy();
    act(() => source.set(stopped));
    await act(async () => { vi.advanceTimersByTime(2_100); });
    expect(window.localStorage.getItem(`${SESSION_STORAGE_PREFIX}tv`)).toBeNull();
    first.view.unmount();

    const restores = answerRestores();
    mount(makeSource(idle));
    await pastRestore();
    expect(restores).toHaveLength(0);
  });

  it('a restored session that was never resumed is not offered again on the next reload', async () => {
    savePersistedSession('tv', { ...playing, state: 'paused' }, { addOnly: false }, { now: Date.now() - 60_000 });
    const originalSavedAt = loadPersistedSession('tv').savedAt;
    const restores = answerRestores();
    const source = makeSource(idle);
    const first = mount(source);
    await pastRestore();
    expect(restores).toHaveLength(1);
    // The screen now shows it paused; nobody presses play for a while.
    act(() => source.set({ ...playing, state: 'paused' }));
    await act(async () => { vi.advanceTimersByTime(30_000); });
    const record = loadPersistedSession('tv');
    expect(record.restored).toBe(true);
    expect(record.savedAt).toBe(originalSavedAt); // age keeps counting from the ORIGINAL save
    first.view.unmount();

    mount(makeSource(idle));
    await pastRestore();
    expect(restores).toHaveLength(1);
  });

  it('a transient playing report during the paused adopt is not a resume', async () => {
    savePersistedSession('tv', { ...playing, state: 'paused' }, null);
    answerRestores();
    const source = makeSource(idle);
    mount(source);
    await pastRestore();
    act(() => source.set(playing)); // renderer blips "playing" while settling paused
    await act(async () => { vi.advanceTimersByTime(7_100); });
    expect(loadPersistedSession('tv').restored).toBe(true);
  });

  it('once a person or remote resumes the restored session it is a live session again', async () => {
    savePersistedSession('tv', { ...playing, state: 'paused' }, null);
    answerRestores();
    const source = makeSource(idle);
    mount(source);
    await pastRestore();
    act(() => { getActionBus().emit('media:playback', { command: 'play', commandId: 'c1' }); });
    act(() => source.set(playing));
    await act(async () => { vi.advanceTimersByTime(2_100); });
    expect(loadPersistedSession('tv').restored).toBe(false);
  });
});

describe('B5 — session modes ride only with a restored session', () => {
  it('does not hydrate Add only without a restored snapshot', async () => {
    savePersistedSession('tv', stopped, { addOnly: true, endOfQueue: 'similar', stopAfterCurrent: true });
    const { controls } = mount(makeSource(idle));
    await pastRestore();
    expect(controls.toPublished()).toMatchObject({ addOnly: false, endOfQueue: 'stop', stopAfterCurrent: false });
  });

  it('hydrates the modes together with a successful restore', async () => {
    savePersistedSession('tv', playing, { addOnly: true, endOfQueue: 'repeat', stopAfterCurrent: false });
    answerRestores();
    const { controls } = mount(makeSource(idle));
    expect(controls.toPublished().addOnly).toBe(false);
    await pastRestore();
    expect(controls.toPublished()).toMatchObject({ addOnly: true, endOfQueue: 'repeat' });
  });
});

describe('persistence cost', () => {
  it('the 5s tick rewrites only the spot of the current item, never the queue', async () => {
    const source = makeSource(idle);
    mount(source);
    await pastRestore();
    act(() => source.set(playing));
    await act(async () => { vi.advanceTimersByTime(2_100); });
    source.getBareSnapshot = () => ({ ...playing, position: 300, queue: { ...playing.queue, items: [item] } });
    await act(async () => { vi.advanceTimersByTime(5_100); });
    const record = loadPersistedSession('tv');
    expect(record.snapshot.position).toBe(300);
    expect(record.snapshot.queue.items).toHaveLength(2); // queue untouched by the tick
  });
});
