import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { landSessionAfterClose } from './landSessionAfterClose.js';
import { FitnessSession } from '../hooks/fitness/FitnessSession.js';
import { resetLiveSessionStore, SESSION_SAVED_EVENT, useLiveSession } from '../lib/liveSessionStore.js';
import { act, renderHook } from '@testing-library/react';

describe('landSessionAfterClose', () => {
  let saved;
  const onSaved = (e) => saved.push(e.detail.sessionId);

  beforeEach(() => {
    saved = [];
    window.addEventListener(SESSION_SAVED_EVENT, onSaved);
    act(() => resetLiveSessionStore());
  });
  afterEach(() => window.removeEventListener(SESSION_SAVED_EVENT, onSaved));

  it('publishes the end of playback before the save returns', async () => {
    let finish;
    const events = [{ type: 'playback_state', timestamp: 1, data: {} }, { type: 'media', timestamp: 1, data: {} }];
    const session = {
      sessionId: 'fs_1',
      timeline: { events },
      flushForLanding: () => new Promise((resolve) => { finish = resolve; }),
    };
    const hook = renderHook(() => useLiveSession());
    let landed;
    act(() => { landed = landSessionAfterClose(session); });

    expect(hook.result.current.sessionId).toBe('fs_1');
    expect(hook.result.current.playbackEvents).toHaveLength(1);
    expect(saved).toEqual([]);

    finish();
    await landed;
    expect(saved).toEqual(['fs_1']);
  });

  it('still tells the screen when the save fails, so it reads what is there', async () => {
    const session = { sessionId: 'fs_1', flushForLanding: () => Promise.reject(new Error('offline')) };
    await expect(landSessionAfterClose(session)).resolves.toBeUndefined();
    expect(saved).toEqual(['fs_1']);
  });

  it('is a no-op without a session', async () => {
    await expect(landSessionAfterClose(null)).resolves.toBeUndefined();
    expect(saved).toEqual([]);
  });
});

describe('FitnessSession.flushForLanding', () => {
  const flush = FitnessSession.prototype.flushForLanding;

  const fake = (over = {}) => {
    const order = [];
    return {
      order,
      sessionId: 'fs_1',
      summary: { sessionId: 'fs_1' },
      _playbackClosingCallbacks: new Set([() => order.push('closed')]),
      _maybeTickTimeline: () => order.push('tick'),
      _persistSession: vi.fn(() => { order.push('save'); return true; }),
      whenFinalPersistSettled: () => { order.push('settled'); return Promise.resolve(); },
      ...over,
    };
  };

  it('closes playback first, so the save carries the end of it', async () => {
    const session = fake();
    const pending = flush.call(session);
    expect(session.order).toEqual(['closed', 'settled']);
    await pending;
    expect(session.order).toEqual(['closed', 'settled', 'tick', 'save', 'settled']);
  });

  it('waits out a save in flight rather than racing it', async () => {
    let release;
    const session = fake({ whenFinalPersistSettled: () => new Promise((r) => { release = r; }) });
    flush.call(session);
    await Promise.resolve();
    expect(session._persistSession).not.toHaveBeenCalled();
    release();
  });

  it('does not force past the session lock', async () => {
    const session = fake();
    await flush.call(session);
    expect(session._persistSession).toHaveBeenCalledWith(session.summary, { force: false });
  });

  it('skips the save when the session ended meanwhile', async () => {
    const session = fake();
    const pending = flush.call(session);
    session.sessionId = null;
    await pending;
    expect(session._persistSession).not.toHaveBeenCalled();
  });

  it('a throwing observer does not lose the save', async () => {
    const session = fake({ _playbackClosingCallbacks: new Set([() => { throw new Error('x'); }]) });
    await flush.call(session);
    expect(session._persistSession).toHaveBeenCalled();
  });
});
