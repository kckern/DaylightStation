import { beforeEach, describe, expect, it } from 'vitest';
import {
  mergeVoiceMemos, publishLiveMemos, publishLivePlayback, resetLiveSessionStore,
  withLiveMemos, withLivePlayback,
} from './liveSessionStore.js';
import { act, renderHook } from '@testing-library/react';
import { useLiveSession } from './liveSessionStore.js';
import { buildPlaybackIntervals } from '../widgets/FitnessSessionDetailWidget/playbackIntervals.js';

const memo = (over = {}) => ({ memoId: 'm1', transcriptClean: 'Felt strong today', ...over });
const live = (hook) => hook.result.current;

describe('liveSessionStore', () => {
  beforeEach(() => act(() => resetLiveSessionStore()));

  it('publishes a memo with the transcript the list and header read', () => {
    const hook = renderHook(() => useLiveSession());
    act(() => publishLiveMemos('fs_1', [memo()]));
    expect(live(hook).sessionId).toBe('fs_1');
    expect(live(hook).memos[0]).toMatchObject({ memoId: 'm1', transcript: 'Felt strong today' });
  });

  it('falls back to the raw transcript and drops empty and "no memo" takes', () => {
    const hook = renderHook(() => useLiveSession());
    act(() => publishLiveMemos('fs_1', [
      { memoId: 'a', transcriptRaw: 'Raw words' },
      { memoId: 'b', transcriptClean: '[No Memo]' },
      { memoId: 'c' },
    ]));
    expect(live(hook).memos.map((m) => m.memoId)).toEqual(['a']);
  });

  it('keeps the last session when its in-memory copy resets', () => {
    const hook = renderHook(() => useLiveSession());
    act(() => publishLiveMemos('fs_1', [memo()]));
    act(() => publishLiveMemos(null, []));
    expect(live(hook).memos).toHaveLength(1);
  });

  it('starts clean for a new session', () => {
    const hook = renderHook(() => useLiveSession());
    act(() => publishLiveMemos('fs_1', [memo()]));
    act(() => publishLivePlayback('fs_1', [{ type: 'playback_state', timestamp: 1, data: {} }]));
    act(() => publishLiveMemos('fs_2', []));
    expect(live(hook)).toMatchObject({ sessionId: 'fs_2', memos: [], playbackEvents: [] });
  });

  it('does not notify when a tick republishes the same memos', () => {
    let renders = 0;
    renderHook(() => { renders += 1; return useLiveSession(); });
    act(() => publishLiveMemos('fs_1', [memo()]));
    const before = renders;
    act(() => publishLiveMemos('fs_1', [memo()]));
    expect(renders).toBe(before);
  });

  it('removes a memo deleted from the live session', () => {
    const hook = renderHook(() => useLiveSession());
    act(() => publishLiveMemos('fs_1', [memo()]));
    act(() => publishLiveMemos('fs_1', []));
    expect(live(hook).memos).toEqual([]);
  });
});

describe('mergeVoiceMemos', () => {
  it('adds a memo the save does not have', () => {
    expect(mergeVoiceMemos([], [{ memoId: 'm1', transcript: 'Hi' }])).toHaveLength(1);
  });
  it('does not double a memo the save has by id or by words', () => {
    const saved = [{ memoId: 'm1', transcript: 'Hi there' }];
    expect(mergeVoiceMemos(saved, [{ memoId: 'm1', transcript: 'Edited' }])).toBe(saved);
    expect(mergeVoiceMemos(saved, [{ memoId: 'other', transcript: 'hi there' }])).toBe(saved);
  });
  it('tolerates a row with no memos', () => {
    expect(mergeVoiceMemos(undefined, [])).toEqual([]);
  });
});

describe('withLiveMemos', () => {
  const liveState = { sessionId: 'fs_1', memos: [{ memoId: 'm1', transcript: 'Hi' }], playbackEvents: [] };

  it('adds the memo to the live session row only', () => {
    const rows = [{ sessionId: 'fs_1', voiceMemos: [] }, { sessionId: 'fs_0', voiceMemos: [] }];
    const next = withLiveMemos(rows, liveState);
    expect(next[0].voiceMemos).toHaveLength(1);
    expect(next[1]).toBe(rows[1]);
  });

  it('returns the same list when nothing changes, so memoized rows hold', () => {
    const rows = [{ sessionId: 'fs_1', voiceMemos: [{ memoId: 'm1', transcript: 'Hi' }] }];
    expect(withLiveMemos(rows, liveState)).toBe(rows);
    const others = [{ sessionId: 'fs_0' }];
    expect(withLiveMemos(others, liveState)).toBe(others);
  });
});

describe('withLivePlayback', () => {
  const START = 1_000_000;
  const axis = { sessionStartMs: START, effectiveTicks: 121, intervalMs: 5000 };
  const event = (observation, state, atMs) => ({
    type: 'playback_state',
    timestamp: START + atMs,
    data: { version: 1, playbackRunId: 'run', contentId: 'plex:1', observation, state },
  });
  const media = { type: 'media', timestamp: START, data: { contentId: 'plex:1', start: START, title: 'Video' } };
  // The snapshot the landing page fetches: playback is open, nothing closes it.
  const stale = { timeline: { events: [media, event('begin', 'playing', 0)] } };

  it('ignores another session', () => {
    expect(withLivePlayback(stale, 'fs_2', { sessionId: 'fs_1', playbackEvents: [event('end', 'none', 600000)] })).toBe(stale);
  });

  it('turns the unknown tail of a stale save into observed playback', () => {
    const before = buildPlaybackIntervals(stale, axis);
    expect(before.map((s) => s.state)).toEqual(['unknown']);

    const liveState = {
      sessionId: 'fs_1',
      memos: [],
      playbackEvents: [event('begin', 'playing', 0), event('end', 'none', 600000)],
    };
    const after = buildPlaybackIntervals(withLivePlayback(stale, 'fs_1', liveState), axis);
    expect(after.map((s) => s.state)).toEqual(['playing']);
    expect(after[0].endMs).toBe(600000);
  });

  it('does not repeat events the save already has', () => {
    const liveState = { sessionId: 'fs_1', memos: [], playbackEvents: [event('begin', 'playing', 0)] };
    expect(withLivePlayback(stale, 'fs_1', liveState)).toBe(stale);
  });
});
