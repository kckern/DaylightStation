import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScreenSessionControls } from './screenSessionControls.js';
import { validateSessionControls } from '@shared-contracts/media/sessionControls.mjs';

const item = (n, extra = {}) => ({ contentId: `plex:${n}`, queueItemId: `q${n}`, title: `Item ${n}`, format: 'video', ...extra });
const episode = (n) => item(n, { type: 'episode', grandparentTitle: 'Show', parentTitle: 'Season 1', itemIndex: n });

function snapshotWith({ state = 'playing', items = [item(1), item(2)], currentIndex = 0, position = 42 } = {}) {
  return {
    sessionId: 's1', state, position,
    currentItem: currentIndex >= 0 ? items[currentIndex] : null,
    queue: { items, currentIndex, upNextCount: 0, executionOrder: items.slice(Math.max(0, currentIndex)).map(i => i.queueItemId) },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
    meta: { ownerId: 'tv', updatedAt: 'x' },
  };
}

function setup(overrides = {}) {
  let snapshot = overrides.snapshot ?? snapshotWith();
  const ports = {
    getSnapshot: vi.fn(() => snapshot),
    stopPlayback: vi.fn(() => true),
    setFade: vi.fn(),
    restoreSnapshot: vi.fn(async () => ({ ok: true })),
    resolveContinuation: vi.fn(async () => []),
    addAutoContinueBatch: vi.fn(async () => ({ ok: true, operationId: 'op-1' })),
    ...overrides.ports,
  };
  const controls = createScreenSessionControls({ ownerId: 'tv', ports, countdownSeconds: 10 });
  const actions = { advance: vi.fn(), stop: vi.fn(), finish: vi.fn(), restartQueue: vi.fn(() => true), release: vi.fn() };
  return { controls, ports, actions, setSnapshot: (s) => { snapshot = s; } };
}

const phone = { kind: 'device', id: 'browser:abc', name: "Dad's phone" };
const routine = { kind: 'routine', name: 'Bedtime', triggerId: 't1' };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T20:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('published controls', () => {
  it('publishes a contract-valid default block', () => {
    const { controls } = setup();
    expect(validateSessionControls(controls.toPublished())).toEqual({ valid: true, errors: [] });
    expect(controls.toPublished()).toMatchObject({ addOnly: false, endOfQueue: 'stop', stopAfterCurrent: false, notes: [] });
  });

  it('applies the three session flags and notifies subscribers', () => {
    const { controls } = setup();
    const listener = vi.fn();
    controls.subscribe(listener);
    expect(controls.applyConfig('addOnly', true)).toEqual({ ok: true });
    expect(controls.applyConfig('endOfQueue', 'similar')).toEqual({ ok: true });
    expect(controls.applyConfig('stopAfterCurrent', true)).toEqual({ ok: true });
    expect(controls.applyConfig('endOfQueue', 'loop')).toMatchObject({ ok: false });
    expect(controls.toPublished()).toMatchObject({ addOnly: true, endOfQueue: 'similar', stopAfterCurrent: true });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('sleep timer (RQ-STEER-12)', () => {
  it('counts down, fades over the last 10s, stops, keeps the queue and records where it was set', async () => {
    const { controls, ports } = setup();
    await controls.handleSession('sleep-timer', { minutes: 1 });
    expect(controls.toPublished().sleepTimer).toMatchObject({ mode: 'minutes', remainingSeconds: 60, fading: false,
      setPosition: { contentId: 'plex:1', queueItemId: 'q1', position: 42 } });
    vi.advanceTimersByTime(50_000);
    expect(controls.toPublished().sleepTimer).toMatchObject({ remainingSeconds: 10, fading: true });
    vi.advanceTimersByTime(5_000);
    const mid = ports.setFade.mock.calls.at(-1)[0];
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(ports.stopPlayback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(ports.stopPlayback).toHaveBeenCalledTimes(1);
    expect(controls.toPublished().sleepTimer).toBeNull();
    expect(controls.toPublished().sleepResume).toMatchObject({ contentId: 'plex:1', queueItemId: 'q1', position: 42, stoppedAt: expect.any(String) });
    vi.advanceTimersByTime(2_000);
    expect(ports.setFade.mock.calls.at(-1)[0]).toBe(1);
  });

  it('dispose restores full output even mid-fade', async () => {
    const { controls, ports } = setup();
    await controls.handleSession('sleep-timer', { minutes: 1 });
    vi.advanceTimersByTime(55_000);
    controls.dispose();
    expect(ports.setFade.mock.calls.at(-1)[0]).toBe(1);
  });

  it('re-arming during a fade restores full output first', async () => {
    const { controls, ports } = setup();
    await controls.handleSession('sleep-timer', { minutes: 1 });
    vi.advanceTimersByTime(55_000);
    await controls.handleSession('sleep-timer', { minutes: 30 });
    expect(ports.setFade.mock.calls.at(-1)[0]).toBe(1);
  });

  it('cancels cleanly and restores full volume', async () => {
    const { controls, ports } = setup();
    await controls.handleSession('sleep-timer', { minutes: 1 });
    vi.advanceTimersByTime(55_000);
    await controls.handleSession('cancel-sleep-timer', {});
    expect(ports.setFade.mock.calls.at(-1)[0]).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(ports.stopPlayback).not.toHaveBeenCalled();
    expect(controls.toPublished().sleepTimer).toBeNull();
  });

  it('stops at the end of the current item when set to atEnd:item', async () => {
    const { controls, actions } = setup();
    await controls.handleSession('sleep-timer', { atEnd: 'item' });
    expect(controls.toPublished().sleepTimer).toMatchObject({ mode: 'atEnd', atEnd: 'item' });
    expect(controls.naturalEndPolicy({ isQueue: true, current: item(1), next: item(2) }, actions)).toBe(true);
    expect(actions.stop).toHaveBeenCalled();
    expect(actions.advance).not.toHaveBeenCalled();
    expect(controls.toPublished().sleepResume).toMatchObject({ contentId: 'plex:1' });
  });

  it('continues from where the timer was set', async () => {
    const { controls, ports, setSnapshot } = setup();
    await controls.handleSession('sleep-timer', { minutes: 1 });
    vi.advanceTimersByTime(60_000);
    setSnapshot(snapshotWith({ state: 'ready', position: 0 }));
    await expect(controls.handleSession('resume-sleep', {})).resolves.toEqual({ ok: true });
    const [restored, opts] = ports.restoreSnapshot.mock.calls.at(-1);
    expect(restored).toMatchObject({ position: 42, state: 'playing', queue: { currentIndex: 0 } });
    expect(opts).toMatchObject({ autoplay: true, reason: 'resume-sleep' });
    expect(controls.toPublished().sleepResume).toBeNull();
  });

  it('refuses resume when nothing was stopped by a timer', async () => {
    const { controls } = setup();
    await expect(controls.handleSession('resume-sleep', {})).resolves.toMatchObject({ ok: false, code: 'SLEEP_RESUME_UNAVAILABLE' });
  });
});

describe('end of queue and next episode (RQ-STEER-19, RQ-STEER-20)', () => {
  it('leaves an ordinary next item to the default advance', () => {
    const { controls, actions } = setup();
    expect(controls.naturalEndPolicy({ isQueue: true, current: item(1), next: item(2) }, actions)).toBe(false);
  });

  it('runs a visible cancellable countdown between episodes, then starts the next', () => {
    const { controls, actions } = setup();
    expect(controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, actions)).toBe(true);
    expect(controls.toPublished().countdown).toMatchObject({ seconds: 10, remainingSeconds: 10, next: { contentId: 'plex:2' } });
    vi.advanceTimersByTime(4_000);
    expect(controls.toPublished().countdown.remainingSeconds).toBe(6);
    vi.advanceTimersByTime(6_000);
    expect(actions.advance).toHaveBeenCalledTimes(1);
    expect(controls.toPublished().countdown).toBeNull();
  });

  it('cancelling the countdown stops on the finished episode; start-now skips the wait', async () => {
    const a = setup();
    a.controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, a.actions);
    await expect(a.controls.handleSession('cancel-countdown', {})).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(20_000);
    expect(a.actions.stop).toHaveBeenCalled();
    expect(a.actions.advance).not.toHaveBeenCalled();

    const b = setup();
    b.controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, b.actions);
    await b.controls.handleSession('start-next-now', {});
    expect(b.actions.advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(b.actions.advance).toHaveBeenCalledTimes(1);
  });

  it('a skip during the countdown supersedes it — the countdown never advances a second time (B4)', () => {
    const { controls, actions } = setup();
    controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, actions);
    // The person skipped: the owner moved on to episode 2 by itself.
    controls.observeSnapshot(snapshotWith({ items: [episode(1), episode(2)], currentIndex: 1 }));
    expect(controls.toPublished().countdown).toBeNull();
    vi.advanceTimersByTime(20_000);
    expect(actions.advance).not.toHaveBeenCalled();
  });

  it('any transport, seek or queue command interrupts the countdown (B4)', () => {
    for (const reason of ['media:playback', 'media:seek-abs', 'media:queue-op']) {
      const { controls, actions } = setup();
      controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, actions);
      controls.interrupt(reason);
      vi.advanceTimersByTime(20_000);
      expect(actions.advance).not.toHaveBeenCalled();
      expect(controls.toPublished().countdown).toBeNull();
    }
  });

  it('an interrupted or superseded countdown releases the finished item so it can complete again', () => {
    const a = setup();
    a.controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, a.actions);
    a.controls.interrupt('media:queue-op');
    expect(a.actions.release).toHaveBeenCalledTimes(1);
    const b = setup();
    b.controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, b.actions);
    b.controls.observeSnapshot(snapshotWith({ items: [episode(1), episode(2)], currentIndex: 1 }));
    expect(b.actions.release).toHaveBeenCalledTimes(1);
  });

  it('keeps the countdown while the finished episode is still current', () => {
    const { controls, actions } = setup();
    controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, actions);
    controls.observeSnapshot(snapshotWith({ items: [episode(1), episode(2)], currentIndex: 0 }));
    vi.advanceTimersByTime(10_000);
    expect(actions.advance).toHaveBeenCalledTimes(1);
  });

  it('stop after this one stops once and clears itself', () => {
    const { controls, actions } = setup();
    controls.applyConfig('stopAfterCurrent', true);
    expect(controls.naturalEndPolicy({ isQueue: true, current: episode(1), next: episode(2) }, actions)).toBe(true);
    expect(actions.stop).toHaveBeenCalled();
    expect(controls.toPublished()).toMatchObject({ stopAfterCurrent: false, endOfQueueStatus: { code: 'STOPPED_AFTER_CURRENT' } });
  });

  it('repeat restarts the queue at its end; stop keeps the default end', () => {
    const { controls, actions } = setup();
    expect(controls.naturalEndPolicy({ isQueue: true, current: item(2), next: null }, actions)).toBe(false);
    controls.applyConfig('endOfQueue', 'repeat');
    expect(controls.naturalEndPolicy({ isQueue: true, current: item(2), next: null }, actions)).toBe(true);
    expect(actions.restartQueue).toHaveBeenCalled();
  });

  it('offers no queue-end behaviour at all for live items', () => {
    const { controls, actions } = setup();
    controls.applyConfig('endOfQueue', 'similar');
    expect(controls.naturalEndPolicy({ isQueue: true, current: item(1, { isLive: true }), next: null }, actions)).toBe(false);
  });

  it('similar: adds an auto-continue batch as one operation, then advances', async () => {
    const batch = [item(7), item(8)];
    const { controls, actions, ports } = setup({ ports: { resolveContinuation: vi.fn(async () => batch) } });
    controls.applyConfig('endOfQueue', 'similar');
    expect(controls.naturalEndPolicy({ isQueue: true, current: item(2), next: null }, actions)).toBe(true);
    await vi.runAllTimersAsync();
    expect(ports.resolveContinuation).toHaveBeenCalledWith(expect.objectContaining({ finished: item(2) }));
    expect(ports.addAutoContinueBatch).toHaveBeenCalledWith(batch.map(i => ({ ...i, addedBy: 'auto-continue' })));
    expect(actions.advance).toHaveBeenCalledTimes(1);
    expect(controls.toPublished().endOfQueueStatus).toMatchObject({ code: 'SIMILAR_ADDED', count: 2 });
  });

  it('similar: stops and says "Nothing similar left" when the container has nothing else', async () => {
    const { controls, actions } = setup();
    controls.applyConfig('endOfQueue', 'similar');
    controls.naturalEndPolicy({ isQueue: true, current: item(2), next: null }, actions);
    await vi.runAllTimersAsync();
    expect(actions.finish).toHaveBeenCalled();
    expect(actions.advance).not.toHaveBeenCalled();
    expect(controls.toPublished().endOfQueueStatus).toMatchObject({ code: 'NOTHING_SIMILAR', message: 'Nothing similar left' });
  });

  it('similar: a newer command while resolving abandons the auto-add', async () => {
    let release;
    const { controls, actions, ports } = setup({ ports: { resolveContinuation: vi.fn(() => new Promise(r => { release = r; })) } });
    controls.applyConfig('endOfQueue', 'similar');
    controls.naturalEndPolicy({ isQueue: true, current: item(2), next: null }, actions);
    controls.markLocalPlayback();
    release([item(9)]);
    await vi.runAllTimersAsync();
    expect(ports.addAutoContinueBatch).not.toHaveBeenCalled();
    expect(actions.advance).not.toHaveBeenCalled();
  });

  it('similar: never re-adds what it already added, so a cycled container ends in "Nothing similar left"', async () => {
    const resolveContinuation = vi.fn(async ({ exclude }) => (exclude.includes('plex:7') ? [] : [item(7)]));
    const { controls, actions } = setup({ ports: { resolveContinuation } });
    controls.applyConfig('endOfQueue', 'similar');
    controls.naturalEndPolicy({ isQueue: true, current: item(2), next: null }, actions);
    await vi.runAllTimersAsync();
    expect(actions.advance).toHaveBeenCalledTimes(1);
    controls.naturalEndPolicy({ isQueue: true, current: item(7), next: null }, actions);
    await vi.runAllTimersAsync();
    expect(resolveContinuation).toHaveBeenLastCalledWith(expect.objectContaining({ exclude: ['plex:7'] }));
    expect(controls.toPublished().endOfQueueStatus).toMatchObject({ code: 'NOTHING_SIMILAR' });
  });

  it('similar: stops after 4 unattended batches; any human input resets the count', async () => {
    let n = 100;
    const resolveContinuation = vi.fn(async () => [item(n++)]);
    const { controls, actions } = setup({ ports: { resolveContinuation } });
    controls.applyConfig('endOfQueue', 'similar');
    const end = async () => {
      controls.naturalEndPolicy({ isQueue: true, current: item(1), next: null }, actions);
      await vi.runAllTimersAsync();
    };
    for (let i = 0; i < 4; i += 1) await end();
    expect(actions.advance).toHaveBeenCalledTimes(4);
    await end();
    expect(actions.advance).toHaveBeenCalledTimes(4);
    expect(actions.finish).toHaveBeenCalledTimes(1);
    expect(controls.toPublished().endOfQueueStatus).toMatchObject({ code: 'NOTHING_SIMILAR' });
    controls.markHumanInput();
    await end();
    expect(actions.advance).toHaveBeenCalledTimes(5);
  });

  it('similar: tops up when the last auto-added item starts', async () => {
    const auto = (n) => item(n, { addedBy: 'auto-continue' });
    const { controls, ports } = setup({ ports: { resolveContinuation: vi.fn(async () => [item(12)]) } });
    controls.applyConfig('endOfQueue', 'similar');
    controls.observeSnapshot(snapshotWith({ items: [item(1), auto(10), auto(11)], currentIndex: 1 }));
    await vi.runAllTimersAsync();
    expect(ports.resolveContinuation).not.toHaveBeenCalled();
    const last = snapshotWith({ items: [item(1), auto(10), auto(11)], currentIndex: 2 });
    controls.observeSnapshot(last);
    controls.observeSnapshot(last);
    await vi.runAllTimersAsync();
    expect(ports.resolveContinuation).toHaveBeenCalledTimes(1);
    expect(ports.addAutoContinueBatch).toHaveBeenCalledWith([{ ...item(12), addedBy: 'auto-continue' }]);
  });
});

describe('screen notes and Put it back (RQ-STEER-21)', () => {
  it('notes a remote pause with its origin, groups repeats, and ignores volume', () => {
    const { controls } = setup();
    expect(controls.noteRemoteCommand({ command: 'config', params: { setting: 'volume', value: 10 }, origin: phone })).toBeNull();
    controls.noteRemoteCommand({ command: 'transport', params: { action: 'pause' }, origin: phone });
    controls.noteRemoteCommand({ command: 'transport', params: { action: 'pause' }, origin: phone });
    const { notes } = controls.toPublished();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'paused', label: "Paused by Dad's phone", count: 2, origin: phone });
    expect(validateSessionControls(controls.toPublished()).valid).toBe(true);
  });

  it('names routines, moves and replacements', () => {
    const { controls } = setup();
    controls.noteRemoteCommand({ command: 'queue', params: { op: 'play-now', contentId: 'plex:9' }, origin: routine });
    controls.noteRemoteCommand({ command: 'transport', params: { action: 'stop', intent: 'move' }, origin: { kind: 'device', id: 'fleet:office-tv' } });
    const labels = controls.toPublished().notes.map(n => n.label);
    expect(labels).toEqual(['Moved by office-tv', 'Replaced by Bedtime']);
  });

  it('makes no note when nothing was playing', () => {
    const { controls } = setup({ snapshot: snapshotWith({ state: 'idle', items: [], currentIndex: -1 }) });
    expect(controls.noteRemoteCommand({ command: 'transport', params: { action: 'stop' }, origin: phone })).toBeNull();
  });

  it('puts back the pre-change item, spot and queue within 10s', async () => {
    const { controls, ports } = setup();
    const before = ports.getSnapshot();
    controls.noteRemoteCommand({ command: 'queue', params: { op: 'play-now', contentId: 'plex:9' }, origin: phone });
    expect(controls.toPublished().notes[0].putBack).toMatchObject({ availableUntil: expect.any(String) });
    await expect(controls.handleSession('put-back', {})).resolves.toEqual({ ok: true });
    expect(ports.restoreSnapshot).toHaveBeenCalledWith(before, expect.objectContaining({ autoplay: true, reason: 'put-back' }));
    expect(controls.toPublished().notes[0].putBack).toBeNull();
  });

  it('refuses Put it back after 10s or once a newer playback owns the screen', async () => {
    const a = setup();
    a.controls.noteRemoteCommand({ command: 'transport', params: { action: 'stop' }, origin: phone });
    vi.advanceTimersByTime(10_001);
    await expect(a.controls.handleSession('put-back', {})).resolves.toMatchObject({ ok: false, code: 'PUT_BACK_UNAVAILABLE' });
    expect(a.controls.toPublished().notes[0].putBack).toBeNull();

    const b = setup();
    b.controls.noteRemoteCommand({ command: 'transport', params: { action: 'stop' }, origin: phone });
    b.controls.markLocalPlayback();
    await expect(b.controls.handleSession('put-back', {})).resolves.toMatchObject({ ok: false, code: 'PUT_BACK_UNAVAILABLE' });
  });

  it('stamps the latest command origin for the snapshot', () => {
    const { controls } = setup();
    controls.stampOrigin(phone);
    expect(controls.getOrigin()).toEqual(phone);
  });
});

describe('session-scoped modes (B5)', () => {
  const setModes = (controls) => {
    controls.applyConfig('addOnly', true);
    controls.applyConfig('endOfQueue', 'similar');
    controls.applyConfig('stopAfterCurrent', true);
  };
  const defaults = { addOnly: false, endOfQueue: 'stop', stopAfterCurrent: false };

  it('clears the modes when the session it belonged to goes idle', () => {
    const { controls } = setup();
    setModes(controls);
    controls.observeSnapshot(snapshotWith());
    expect(controls.toPublished().addOnly).toBe(true);
    controls.observeSnapshot(snapshotWith({ state: 'idle', items: [], currentIndex: -1 }));
    expect(controls.toPublished()).toMatchObject(defaults);
  });

  it('keeps modes set on an idle screen until a session has come and gone', () => {
    const { controls } = setup({ snapshot: snapshotWith({ state: 'idle', items: [], currentIndex: -1 }) });
    setModes(controls);
    controls.observeSnapshot(snapshotWith({ state: 'idle', items: [], currentIndex: -1 }));
    expect(controls.toPublished().addOnly).toBe(true);
  });

  it('clears the modes on a new local or URL start', () => {
    const { controls } = setup();
    setModes(controls);
    controls.markLocalPlayback();
    expect(controls.toPublished()).toMatchObject(defaults);
  });
});

describe('persistence', () => {
  it('persists and re-hydrates the session modes and the sleep resume point', async () => {
    const { controls } = setup();
    controls.applyConfig('addOnly', true);
    controls.applyConfig('endOfQueue', 'repeat');
    await controls.handleSession('sleep-timer', { minutes: 1 });
    vi.advanceTimersByTime(60_000);
    const saved = controls.persistable();
    const other = setup().controls;
    other.hydrate(saved);
    expect(other.toPublished()).toMatchObject({ addOnly: true, endOfQueue: 'repeat', sleepResume: { contentId: 'plex:1' } });
  });
});
