// Screen session controls on THIS device's Media session (P1): sleep timer
// (RQ-STEER-12), end of queue + keep similar playing (RQ-STEER-19), the
// next-episode countdown and Stop after this one (RQ-STEER-20). The local
// session runs the screen's rule set, bound through ports (its sleep timer
// pauses rather than stops).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLocalSessionController } from './LocalSessionController.js';
import mediaLog from '../logging/mediaLog.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    data,
  };
}

function makeController({ resolveContinuation = async () => [], storage = memoryStorage(), countdownSeconds } = {}) {
  let n = 0;
  const player = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
  const c = createLocalSessionController({
    clientId: 'c1',
    randomUuid: () => `id-${++n}`,
    sessionControls: { resolveContinuation, storage, ...(countdownSeconds != null ? { countdownSeconds } : {}) },
  });
  c.setPlayerHandle(player);
  return { c, player, storage };
}

const ep = (id, title = id) => ({ contentId: id, title, format: 'video', type: 'episode', duration: 600 });
const song = (id) => ({ contentId: id, title: id, format: 'audio', duration: 200 });
const playing = (c) => c.store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('sleep timer (RQ-STEER-12)', () => {
  it('counts down, fades the output over the last 10 s, pauses, and records where the timer was set', async () => {
    vi.useFakeTimers();
    const { c, player } = makeController();
    c.queue.playNow(song('a'));
    playing(c);
    c.onPlayerPositionTick(42, 'a');
    await c.sessionControls.setSleepTimer({ minutes: 1 });
    expect(c.sessionControls.getState().sleepTimer).toMatchObject({ mode: 'minutes', minutes: 1, remainingSeconds: 60 });
    expect(c.sessionControls.getState().sleepTimer.setPosition).toMatchObject({ contentId: 'a', position: 42 });
    expect(c.output.getFade()).toBe(1);

    vi.advanceTimersByTime(55_000);
    expect(c.sessionControls.getState().sleepTimer.fading).toBe(true);
    expect(c.output.getFade()).toBeLessThan(1);
    expect(player.pause).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    expect(player.pause).toHaveBeenCalled();
    expect(c.sessionControls.getState().sleepTimer).toBeNull();
    expect(c.sessionControls.getState().sleepResume).toMatchObject({ contentId: 'a', position: 42 });
    // The output returns to full once the pause has landed.
    vi.advanceTimersByTime(1_100);
    expect(c.output.getFade()).toBe(1);
    // A paused session keeps its item, so "where it stopped" is plain Play.
    expect(c.getSnapshot().currentItem?.contentId).toBe('a');
    expect(mediaLog.sleepTimerChanged).toHaveBeenCalledWith(expect.objectContaining({ target: 'local', state: 'set', minutes: 1 }));
    expect(mediaLog.sleepTimerChanged).toHaveBeenCalledWith(expect.objectContaining({ target: 'local', state: 'stopped' }));
  });

  it('at the end of this item stops there instead of advancing', async () => {
    const { c } = makeController();
    c.queue.playNow(ep('e1'));
    c.queue.add(ep('e2'));
    playing(c);
    await c.sessionControls.setSleepTimer({ atEnd: 'item' });
    c.onPlayerEnded('e1');
    expect(c.getSnapshot().currentItem?.contentId).toBe('e1');
    expect(c.getSnapshot().state).toBe('ended');
    expect(c.sessionControls.getState().countdown).toBeNull();
    expect(c.sessionControls.getState().sleepResume).toMatchObject({ contentId: 'e1' });
  });

  it('continue from where the timer was set restores that item and spot and plays', async () => {
    vi.useFakeTimers();
    const { c } = makeController();
    c.queue.playNow(song('a'));
    c.queue.add(song('b'));
    playing(c);
    c.onPlayerPositionTick(30, 'a');
    await c.sessionControls.setSleepTimer({ minutes: 1 });
    c.transport.skipNext();
    vi.advanceTimersByTime(60_000);
    expect(c.getSnapshot().currentItem?.contentId).toBe('b');
    const result = await c.sessionControls.resumeSleep();
    expect(result).toEqual({ ok: true });
    expect(c.getSnapshot().currentItem?.contentId).toBe('a');
    expect(c.getSnapshot().position).toBe(30);
    expect(c.sessionControls.getState().sleepResume).toBeNull();
  });

  it('cancel restores full output and leaves playback alone', async () => {
    vi.useFakeTimers();
    const { c, player } = makeController();
    c.queue.playNow(song('a'));
    playing(c);
    await c.sessionControls.setSleepTimer({ minutes: 1 });
    vi.advanceTimersByTime(55_000);
    await c.sessionControls.cancelSleepTimer();
    expect(c.output.getFade()).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(player.pause).not.toHaveBeenCalled();
    expect(c.sessionControls.getState().sleepTimer).toBeNull();
  });
});

describe('next episode countdown and Stop after this one (RQ-STEER-20)', () => {
  it('shows a cancellable countdown at the end of an episode, then starts the next', async () => {
    vi.useFakeTimers();
    const { c } = makeController();
    c.queue.playNow(ep('e1', 'Hospital'));
    c.queue.add(ep('e2', 'Keepy Uppy'));
    playing(c);
    c.onPlayerEnded('e1');
    expect(c.getSnapshot().currentItem?.contentId).toBe('e1');
    expect(c.sessionControls.getState().countdown).toMatchObject({
      seconds: 10, remainingSeconds: 10, next: { contentId: 'e2', title: 'Keepy Uppy' }, current: { contentId: 'e1' },
    });
    vi.advanceTimersByTime(10_000);
    expect(c.getSnapshot().currentItem?.contentId).toBe('e2');
    expect(c.sessionControls.getState().countdown).toBeNull();
  });

  it('cancel stops on the finished episode with the queue kept', async () => {
    vi.useFakeTimers();
    const { c } = makeController();
    c.queue.playNow(ep('e1'));
    c.queue.add(ep('e2'));
    playing(c);
    c.onPlayerEnded('e1');
    expect((await c.sessionControls.cancelCountdown()).ok).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(c.getSnapshot().currentItem?.contentId).toBe('e1');
    expect(c.getSnapshot().state).toBe('ended');
    expect(c.getSnapshot().queue.items).toHaveLength(2);
  });

  it('start now skips the rest of the countdown', async () => {
    vi.useFakeTimers();
    const { c } = makeController();
    c.queue.playNow(ep('e1'));
    c.queue.add(ep('e2'));
    playing(c);
    c.onPlayerEnded('e1');
    await c.sessionControls.startNextNow();
    expect(c.getSnapshot().currentItem?.contentId).toBe('e2');
  });

  it('a person skipping during the countdown supersedes it (no double advance)', async () => {
    vi.useFakeTimers();
    const { c } = makeController();
    c.queue.playNow(ep('e1'));
    c.queue.add(ep('e2'));
    c.queue.add(ep('e3'));
    playing(c);
    c.onPlayerEnded('e1');
    c.transport.skipNext();
    expect(c.getSnapshot().currentItem?.contentId).toBe('e2');
    vi.advanceTimersByTime(20_000);
    expect(c.getSnapshot().currentItem?.contentId).toBe('e2');
  });

  it('music (not episodes) advances at once, without a countdown', () => {
    const { c } = makeController();
    c.queue.playNow(song('a'));
    c.queue.add(song('b'));
    playing(c);
    c.onPlayerEnded('a');
    expect(c.getSnapshot().currentItem?.contentId).toBe('b');
    expect(c.sessionControls.getState().countdown).toBeNull();
  });

  it('Stop after this one stops at the end of the current item once, then clears itself', async () => {
    const { c } = makeController();
    c.queue.playNow(ep('e1'));
    c.queue.add(ep('e2'));
    playing(c);
    await c.sessionControls.setStopAfterCurrent(true);
    expect(c.sessionControls.getState().stopAfterCurrent).toBe(true);
    c.onPlayerEnded('e1');
    expect(c.getSnapshot().currentItem?.contentId).toBe('e1');
    expect(c.getSnapshot().state).toBe('ended');
    expect(c.sessionControls.getState()).toMatchObject({
      stopAfterCurrent: false, endOfQueueStatus: { code: 'STOPPED_AFTER_CURRENT' },
    });
  });
});

describe('end of queue: stop, repeat, keep similar playing (RQ-STEER-19)', () => {
  it('repeat restarts the queue at its first item', async () => {
    const { c } = makeController();
    c.queue.playNow(song('a'));
    c.queue.add(song('b'));
    playing(c);
    await c.sessionControls.setEndOfQueue('repeat');
    c.onPlayerEnded('a');
    c.onPlayerEnded('b');
    expect(c.getSnapshot().currentItem?.contentId).toBe('a');
  });

  it('similar appends one marked batch from the resolver and plays on', async () => {
    const resolveContinuation = vi.fn(async () => [
      { id: 'plex:9', title: 'Nine', type: 'track', duration: 180 },
      { id: 'plex:10', title: 'Ten', type: 'track', duration: 180 },
    ]);
    const { c } = makeController({ resolveContinuation });
    c.queue.playNow(song('a'));
    playing(c);
    await c.sessionControls.setEndOfQueue('similar');
    c.onPlayerEnded('a');
    await flush(); await flush(); await flush();
    expect(resolveContinuation).toHaveBeenCalledWith(expect.objectContaining({ finished: expect.objectContaining({ contentId: 'a' }) }));
    const items = c.getSnapshot().queue.items;
    expect(items.map((it) => it.contentId)).toEqual(['a', 'plex:9', 'plex:10']);
    expect(items.slice(1).every((it) => it.addedBy === 'auto-continue')).toBe(true);
    expect(c.getSnapshot().currentItem?.contentId).toBe('plex:9');
    expect(c.sessionControls.getState().endOfQueueStatus).toMatchObject({ code: 'SIMILAR_ADDED', count: 2 });
  });

  it('nothing similar left stops and says so', async () => {
    const { c } = makeController({ resolveContinuation: async () => [] });
    c.queue.playNow(song('a'));
    playing(c);
    await c.sessionControls.setEndOfQueue('similar');
    c.onPlayerEnded('a');
    await flush(); await flush();
    expect(c.getSnapshot().state).toBe('ended');
    expect(c.sessionControls.getState().endOfQueueStatus).toMatchObject({ code: 'NOTHING_SIMILAR', message: 'Nothing similar left' });
  });

  it('remembers the choice across a reload of this device', async () => {
    const storage = memoryStorage();
    const first = makeController({ storage });
    first.c.queue.playNow(song('a'));
    await first.c.sessionControls.setEndOfQueue('similar');
    const second = makeController({ storage });
    expect(second.c.sessionControls.getState().endOfQueue).toBe('similar');
  });

  it('Add only and Put it back are screen-only here, with a reason', async () => {
    const { c } = makeController();
    expect(c.sessionControls.supports.addOnly).toBe(false);
    expect(await c.sessionControls.setAddOnly(true)).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(await c.sessionControls.putBack()).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
  });
});


describe('Play after an item ended here', () => {
  it('replays it from the start as a new visit, so its next end is a new end', async () => {
    const resolveContinuation = vi.fn(async () => [{ id: 'plex:9', title: 'Nine', type: 'track', duration: 180 }]);
    const { c, player } = makeController({ resolveContinuation });
    c.queue.playNow(song('a'));
    playing(c);
    await c.sessionControls.setStopAfterCurrent(true);
    c.onPlayerEnded('a');
    expect(c.getSnapshot().state).toBe('ended');
    await c.sessionControls.setEndOfQueue('similar');
    c.transport.play();
    expect(c.getSnapshot().state).toBe('loading');
    expect(c.getSnapshot().position).toBe(0);
    expect(player.play).toHaveBeenCalled();
    playing(c);
    c.onPlayerEnded('a');
    await flush(); await flush(); await flush();
    expect(c.getSnapshot().currentItem?.contentId).toBe('plex:9');
  });

  it('keeps the commanding origin on the replay it starts', async () => {
    const { c } = makeController();
    c.queue.playNow(song('a'));
    playing(c);
    await c.sessionControls.setStopAfterCurrent(true);
    c.onPlayerEnded('a');
    expect(c.getSnapshot().state).toBe('ended');
    const origin = { kind: 'routine', name: 'Bedtime', triggerId: 't1' };
    c.setOrigin(origin);
    c.transport.play();
    expect(c.getSnapshot().meta.origin).toEqual(origin);
  });
});
