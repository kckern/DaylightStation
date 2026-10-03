import { act, cleanup, render, waitFor } from '@testing-library/react';
import React, { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Subtitles and audio language (RQ-STEER-14) at the Player seam. The track
// features are OPT-IN: a Player no owner claims (garage, piano, school, any
// existing owner) resolves, renders and registers exactly as before.

const frames = [];
vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: (props) => {
    frames.push(props);
    return <div data-testid="single-player-stub" />;
  },
}));
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test'))),
}));

import Player from './Player.jsx';
import { registerTrackOwner, createTrackPreferenceStore, __resetTrackOwners } from './lib/trackPolicy.js';
import { getPlayerQueueOpRegistry } from './lib/queueOpRegistry.js';

const latest = () => frames.at(-1);
const streams = (ids) => [
  { id: ids.audio, streamType: 2, languageCode: 'eng', displayTitle: 'English', selected: true },
  { id: ids.eng, streamType: 3, languageCode: 'eng', displayTitle: 'English' },
  { id: ids.ell, streamType: 3, languageCode: 'ell', displayTitle: 'Ελληνικά' },
];
const info = (ratingKey, ids) => ({
  id: `plex:${ratingKey}`, format: 'dash_video', mediaType: 'dash_video',
  mediaUrl: `/api/v1/proxy/plex/stream/${ratingKey}?session=s1`,
  metadata: { type: 'episode', grandparentId: '665636', Media: [{ Part: [{ id: 1, Stream: streams(ids) }] }] },
});
const EP1 = info('665638', { audio: 1278356, eng: 1278358, ell: 1278377 });
const EP2 = info('665639', { audio: 1278401, eng: 1278403, ell: 1278422 });

beforeEach(() => { frames.length = 0; __resetTrackOwners(); });
afterEach(() => { cleanup(); __resetTrackOwners(); });

describe('Player tracks — no owner (default behaviour unchanged)', () => {
  it('passes the resolved item through untouched and refuses track commands', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={{ contentId: 'plex:665638' }} clear={() => {}} />);
    await waitFor(() => expect(latest()?.resolveTracks).toBeTypeOf('function'));
    expect(latest().resolveTracks(EP1)).toBe(EP1);
    act(() => { latest().onResolvedMeta(EP1); });
    expect(ref.current.setTracks({ subtitle: '1278358' })).toEqual({ ok: false, code: 'TRACKS_NOT_OWNED' });
  });

  it('an ordinary Player still takes screen queue commands; an auxiliary one never does', async () => {
    const registry = getPlayerQueueOpRegistry();
    const spy = vi.spyOn(registry, 'register');
    const { unmount } = render(<Player play={{ contentId: 'plex:1' }} clear={() => {}} />);
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    spy.mockClear();
    render(<Player auxiliary play={{ contentId: 'plex:2' }} clear={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Player tracks — an opted-in owner', () => {
  function owned(ref) {
    const store = createTrackPreferenceStore({ namespace: `test-${Math.random()}`, storage: null });
    const onTracks = vi.fn();
    registerTrackOwner({
      isOwner: (id) => id === ref.current?.getPlayerInstanceId?.(),
      getPreference: store.get, setPreference: store.set, onTracks,
    });
    return { store, onTracks };
  }

  it('reports only the tracks the item has (STEER.12a/AC2)', async () => {
    const ref = createRef();
    const { onTracks } = owned(ref);
    render(<Player ref={ref} play={{ contentId: 'plex:665638' }} clear={() => {}} />);
    await waitFor(() => expect(latest()?.onResolvedMeta).toBeTypeOf('function'));
    act(() => { latest().onResolvedMeta(EP1); });
    await waitFor(() => expect(onTracks).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'plex:665638', source: 'plex' }), expect.anything(),
    ));
    const state = onTracks.mock.calls.at(-1)[0];
    expect(state.subtitles.map((t) => t.id)).toEqual(['1278358', '1278377']);
    expect(ref.current.getTracks().selected).toEqual({ audio: '1278356', subtitle: null });
  });

  it('a choice re-streams the item at its spot and carries on to the next episode (AC3)', async () => {
    const ref = createRef();
    owned(ref);
    render(<Player ref={ref} play={{ contentId: 'plex:665638' }} clear={() => {}} />);
    await waitFor(() => expect(latest()?.onResolvedMeta).toBeTypeOf('function'));
    act(() => { latest().onResolvedMeta(EP1); });
    const keyBefore = latest().remountDiagnostics ?? null;

    let result;
    act(() => { result = ref.current.setTracks({ subtitle: '1278358' }); });
    expect(result).toEqual({ ok: true, appliedBy: 'restream' });
    // The SinglePlayer is rebuilt (fresh fetch → fresh mint) with the choice.
    await waitFor(() => expect(latest().remountDiagnostics).not.toBe(keyBefore));
    expect(latest().remountDiagnostics).toMatchObject({ reason: 'track-change', source: 'tracks' });
    expect(latest().resolveTracks(EP1).mediaUrl).toMatch(/subtitleStreamID=1278358$/);
    // Same show, next episode: its own English stream id.
    expect(latest().resolveTracks(EP2).mediaUrl).toMatch(/subtitleStreamID=1278403$/);
  });

  it('refuses a track the item does not have', async () => {
    const ref = createRef();
    owned(ref);
    render(<Player ref={ref} play={{ contentId: 'plex:665638' }} clear={() => {}} />);
    await waitFor(() => expect(latest()?.onResolvedMeta).toBeTypeOf('function'));
    act(() => { latest().onResolvedMeta(EP1); });
    expect(ref.current.setTracks({ subtitle: '999' })).toEqual({ ok: false, code: 'UNKNOWN_TRACK' });
  });
});
