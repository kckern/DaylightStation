import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { createSessionStore } from './sessionStore.js';
import { attachPersistence, attachRecents, attachLogging } from './attachments.js';
import mediaLog from '../logging/mediaLog.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

function makeStore() {
  return createSessionStore(createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'c1' }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('attachPersistence', () => {
  it('writes immediately on the first transition (leading edge)', () => {
    const store = makeStore();
    const write = vi.fn(() => ({ ok: true }));
    attachPersistence(store, { write, nowFn: () => Date.now() });
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 70 } });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1]).toEqual({ wasPlayingOnUnload: false });
  });

  it('throttles to ≤1 write per window, trailing write captures the latest state', () => {
    const store = makeStore();
    const write = vi.fn(() => ({ ok: true }));
    attachPersistence(store, { write });
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 10 } }); // leading write
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 20 } }); // within window
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 30 } }); // within window
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].config.volume).toBe(30); // trailing = latest
  });

  it('flags wasPlayingOnUnload while playing', () => {
    const store = makeStore();
    const write = vi.fn(() => ({ ok: true }));
    attachPersistence(store, { write });
    store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    vi.advanceTimersByTime(600);
    store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    vi.advanceTimersByTime(600);
    const lastCall = write.mock.calls[write.mock.calls.length - 1];
    expect(lastCall[1]).toEqual({ wasPlayingOnUnload: true });
  });

  it('detach cancels the trailing write', () => {
    const store = makeStore();
    const write = vi.fn(() => ({ ok: true }));
    const detach = attachPersistence(store, { write });
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 10 } });
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 20 } });
    detach();
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('attachRecents', () => {
  it('records when a new item loads', () => {
    const store = makeStore();
    const record = vi.fn();
    attachRecents(store, { record });
    store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video', title: 'T' } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'p:1', title: 'T' }));
  });

  it('records on transition into playing', () => {
    const store = makeStore();
    store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const record = vi.fn();
    attachRecents(store, { record });
    store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'p:1' }));
  });

  it('does not record config-only changes', () => {
    const store = makeStore();
    const record = vi.fn();
    attachRecents(store, { record });
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 10 } });
    expect(record).not.toHaveBeenCalled();
  });
});

describe('attachLogging', () => {
  it('emits sessionStateChange on state transitions only', () => {
    const store = makeStore();
    attachLogging(store);
    store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    expect(mediaLog.sessionStateChange).toHaveBeenCalledWith(expect.objectContaining({
      prevState: 'idle', nextState: 'loading',
    }));
    mediaLog.sessionStateChange.mockClear();
    store.dispatch({ type: 'SET_CONFIG', patch: { volume: 5 } });
    expect(mediaLog.sessionStateChange).not.toHaveBeenCalled();
  });

  it('emits playbackStarted on transition into playing', () => {
    const store = makeStore();
    attachLogging(store);
    store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    expect(mediaLog.playbackStarted).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1', contentId: 'p:1',
    }));
  });
});
