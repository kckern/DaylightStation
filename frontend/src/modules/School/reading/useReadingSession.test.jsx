/**
 * The half of the reading session the backend cannot see: the pick being
 * committed, the story starting, and the story finishing.
 *
 * Three rules are load-tested here because each of them fails INVISIBLY in the
 * field — nothing on any screen would look wrong:
 *   1. attribution is frozen at pick time (D4) — a sibling wandering past
 *      mid-story must not inherit the read;
 *   2. one pick is one `pickId`, and `ended` twice is still one book;
 *   3. a read that did NOT record is never shown as though it had (§9).
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ handler: null }));

vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handler = cb; },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

import { useReadingSession } from './useReadingSession.js';

const SUMMARY = {
  learnerId: 'learner-c', displayName: 'Learner C', enrolled: true, error: false,
  count: 1, target: 2, progressLabel: '1 of 2 stories', doneToday: false, yesterday: [],
};

let calls;

function stubFetch({ summary = SUMMARY, readOk = true } = {}) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const href = String(url);
    calls.push({ url: href, body: opts?.body ? JSON.parse(opts.body) : null });
    if (href.includes('/reading/read')) {
      return Promise.resolve({ ok: readOk, status: readOk ? 200 : 500, json: async () => ({ recorded: readOk }) });
    }
    if (href.includes('/reading/playing')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, state: 'reading' }) });
    }
    if (href.includes('/reading/summary')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => summary });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ title: 'Frog and Toad' }) });
  }));
}

const posted = (path) => calls.filter((c) => c.url.includes(path));

async function mountAndPick({ learnerId = 'learner-c', contentId = 'plex:620681' } = {}) {
  const played = [];
  const hook = renderHook(() => useReadingSession({
    location: 'livingroom', confirmMs: 1000, onPlay: (pick) => played.push(pick),
  }));
  await act(async () => { h.handler({ event: 'session-open', learnerId, location: 'livingroom' }); });
  await act(async () => { h.handler({ event: 'book-selected', learnerId, contentId }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  return { ...hook, played };
}

describe('useReadingSession — playback', () => {
  beforeEach(() => {
    h.handler = null;
    stubFetch();
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date',
        'requestAnimationFrame', 'cancelAnimationFrame'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('commits the pick exactly once, with a pickId, and hands it to the player', async () => {
    const { played, result } = await mountAndPick();
    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({ learnerId: 'learner-c', contentId: 'plex:620681', location: 'livingroom' });
    expect(played[0].pickId).toMatch(/^pick_/);
    expect(result.current.view).toBe('playing');
  });

  it('reports the FIRST FRAME to the backend, once, with the pick it committed', async () => {
    const { played, result } = await mountAndPick();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackStarted(); });

    expect(posted('/reading/playing')).toHaveLength(1);
    expect(posted('/reading/playing')[0].body).toMatchObject({
      location: 'livingroom', learnerId: 'learner-c', contentId: 'plex:620681', pickId: played[0].pickId,
    });
  });

  it('records the read on completion, with the SAME pickId the play was committed under', async () => {
    const { played, result } = await mountAndPick();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });

    expect(posted('/reading/read')).toHaveLength(1);
    expect(posted('/reading/read')[0].body).toMatchObject({
      learnerId: 'learner-c', contentId: 'plex:620681', pickId: played[0].pickId, location: 'livingroom',
    });
  });

  it('a player that fires ended TWICE credits one book', async () => {
    const { result } = await mountAndPick();
    await act(async () => { await result.current.notePlaybackCompleted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(posted('/reading/read')).toHaveLength(1);
  });

  // D4. The screen belongs to whoever is standing there; the story keeps the
  // credit it was picked with. Re-reading the learner at completion is the one
  // mistake here that nobody would ever notice.
  it('credits the child who PICKED, even after another card swapped the screen mid-story', async () => {
    const { result } = await mountAndPick({ learnerId: 'learner-c' });
    await act(async () => { h.handler({ event: 'session-open', learnerId: 'learner-d', location: 'livingroom' }); });
    expect(result.current.view).toBe('playing');          // the story is not interrupted
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(posted('/reading/read')[0].body.learnerId).toBe('learner-c');
  });

  it('records NOTHING when the player goes away without the story ending', async () => {
    const { result } = await mountAndPick();
    await act(async () => { result.current.notePlaybackDismissed(); });
    expect(posted('/reading/read')).toEqual([]);
    expect(result.current.view).toBe('open');
  });

  it('says so when the read did not save — never a count that did not move', async () => {
    stubFetch({ readOk: false });
    const { result } = await mountAndPick();
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.notice).toMatchObject({ tone: 'error' });
    expect(result.current.view).toBe('open');
  });

  it('celebrates only when the read that just landed MET the target', async () => {
    stubFetch({ summary: { ...SUMMARY, count: 2, progressLabel: '2 of 2 stories', doneToday: true } });
    const { result } = await mountAndPick();
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.view).toBe('celebrating');
    expect(result.current.summary.progressLabel).toBe('2 of 2 stories');
  });

  it('goes back to the prompt for the next book when stories are still owed', async () => {
    const { result } = await mountAndPick();
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.view).toBe('open');
  });

  it('carries the title the info lookup found onto the recorded read', async () => {
    const { result } = await mountAndPick();
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(posted('/reading/read')[0].body.title).toBe('Frog and Toad');
  });

  it('exposes the countdown in the shape LaunchCard already draws', async () => {
    const played = [];
    const { result } = renderHook(() => useReadingSession({
      location: 'livingroom', confirmMs: 1000, onPlay: (p) => played.push(p),
    }));
    await act(async () => { h.handler({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' }); });
    expect(result.current.confirmRemainingMs).toBeNull();
    expect(result.current.confirmTotalMs).toBeNull();

    await act(async () => { h.handler({ event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:1' }); });
    expect(result.current.confirmTotalMs).toBe(1000);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(result.current.confirmRemainingMs).toBeLessThan(1000);
    expect(result.current.confirmRemainingMs).toBeGreaterThan(0);
  });
});
