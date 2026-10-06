import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyRememberedTracks, trackStateFor, checkSelection, rememberSelection, preferenceKeyFor,
} from './playerTracks.js';
import { registerTrackOwner, getTrackOwner, createTrackPreferenceStore, __resetTrackOwners } from './trackPolicy.js';
import { nativeTrackEngine, hlsTrackEngine, dashTrackEngine, trackEngineFor } from './engineTracks.js';

const streams = (ids) => [
  { id: ids.audio, streamType: 2, languageCode: 'eng', displayTitle: 'English', selected: true },
  { id: ids.forced, streamType: 3, languageCode: 'eng', displayTitle: 'English Forced', forced: true },
  { id: ids.eng, streamType: 3, languageCode: 'eng', displayTitle: 'English' },
  { id: ids.ell, streamType: 3, languageCode: 'ell', displayTitle: 'Ελληνικά' },
];
const episode = (ratingKey, ids) => ({
  id: `plex:${ratingKey}`,
  mediaUrl: `/api/v1/proxy/plex/stream/${ratingKey}?session=s1`,
  metadata: { type: 'episode', grandparentId: '665636', Media: [{ Part: [{ id: 1, Stream: streams(ids) }] }] },
});
const EP1 = episode('665638', { audio: 1278356, forced: 1278357, eng: 1278358, ell: 1278377 });
const EP2 = episode('665639', { audio: 1278401, forced: 1278402, eng: 1278403, ell: 1278422 });

describe('applyRememberedTracks', () => {
  it('leaves an item untouched when nothing was chosen', () => {
    const out = applyRememberedTracks(EP1, () => null);
    expect(out.info).toBe(EP1);
    expect(out.applied).toBeNull();
  });

  it('leaves a non-Plex item untouched even with a choice', () => {
    const local = { id: 'media:x', mediaUrl: '/api/v1/proxy/media/stream/x.mp4', metadata: EP1.metadata };
    expect(applyRememberedTracks(local, () => ({ subtitle: { language: 'eng', label: 'English' } })).info).toBe(local);
  });

  it('carries a show choice to the next episode as its own stream id (STEER.12a/AC3)', () => {
    const store = createTrackPreferenceStore({ namespace: 't', storage: null });
    const state = trackStateFor(EP1);
    rememberSelection(EP1, state, { subtitle: '1278358' }, store.get, store.set);
    expect(preferenceKeyFor(EP2)).toBe('show:665636');
    const out = applyRememberedTracks(EP2, store.get);
    expect(out.applied).toEqual({ subtitle: '1278403' });
    expect(out.info.mediaUrl).toBe('/api/v1/proxy/plex/stream/665639?session=s1&subtitleStreamID=1278403');
    expect(trackStateFor(out.info, { applied: out.applied }).selected.subtitle).toBe('1278403');
  });
});

describe('trackStateFor / checkSelection', () => {
  it('lists only what the item has (STEER.12a/AC2)', () => {
    const state = trackStateFor(EP1);
    expect(state.audio).toHaveLength(1);
    expect(state.subtitles.map((t) => t.language)).toEqual(['eng', 'eng', 'ell']);
    expect(checkSelection(state, { subtitle: '1278377' })).toBeNull();
    expect(checkSelection(state, { subtitle: 'off' })).toBeNull();
    expect(checkSelection(state, { subtitle: '42' })).toBe('UNKNOWN_TRACK');
    expect(checkSelection(null, { subtitle: 'off' })).toBe('NO_TRACKS');
  });

  it('falls back to the engine for streams without Plex metadata', () => {
    const engine = { list: () => ({ source: 'hls', audio: [{ id: '0', language: 'en', label: 'English' }], subtitles: [], selected: { audio: '0', subtitle: null } }) };
    expect(trackStateFor({ id: 'x', mediaUrl: '/a.m3u8' }, { engine }).source).toBe('hls');
    expect(trackStateFor({ id: 'x', mediaUrl: '/a.m3u8' })).toBeNull();
  });
});

describe('trackPolicy owners', () => {
  beforeEach(() => __resetTrackOwners());

  it('claims only the Player its owner names', () => {
    const owner = { isOwner: (id) => id === 'p1' };
    const off = registerTrackOwner(owner);
    expect(getTrackOwner('p1')).toBe(owner);
    expect(getTrackOwner('p2')).toBeNull();
    expect(getTrackOwner(null)).toBeNull();
    off();
    expect(getTrackOwner('p1')).toBeNull();
  });

  it('a throwing owner claims nothing', () => {
    registerTrackOwner({ isOwner: () => { throw new Error('x'); } });
    expect(getTrackOwner('p1')).toBeNull();
  });

  it('remembers choices in browser storage, bounded', () => {
    const backing = new Map();
    const storage = { getItem: (k) => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, v) };
    const a = createTrackPreferenceStore({ namespace: 'dev', storage });
    a.set('show:1', { subtitle: 'off' });
    expect(createTrackPreferenceStore({ namespace: 'dev', storage }).get('show:1')).toEqual({ subtitle: 'off' });
    for (let i = 0; i < 205; i += 1) a.set(`item:${i}`, { subtitle: 'off' });
    expect(Object.keys(JSON.parse(backing.get('daylight.track-preferences.v1:dev')))).toHaveLength(200);
  });

  it('survives storage that throws', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const s = createTrackPreferenceStore({ namespace: 'x', storage });
    s.set('k', { subtitle: 'off' });
    expect(s.get('k')).toEqual({ subtitle: 'off' });
  });
});

describe('engine adapters', () => {
  it('native: lists text tracks and shows the chosen one', () => {
    const text = [
      { kind: 'subtitles', language: 'en', label: 'English', mode: 'disabled' },
      { kind: 'metadata', language: '', label: 'chapters', mode: 'hidden' },
      { kind: 'captions', language: 'fr', label: 'Français', mode: 'disabled' },
    ];
    const el = { textTracks: text };
    const engine = nativeTrackEngine(el);
    expect(engine.list().subtitles.map((t) => t.label)).toEqual(['English', 'Français']);
    expect(engine.select({ subtitle: '1' })).toBe(true);
    expect(text[2].mode).toBe('showing');
    expect(text[0].mode).toBe('disabled');
    engine.select({ subtitle: 'off' });
    expect(text[2].mode).toBe('disabled');
  });

  it('hls: switches audio and subtitle tracks through hls.js', () => {
    const hls = { audioTracks: [{ lang: 'en', name: 'English' }, { lang: 'ja', name: '日本語' }], audioTrack: 0, subtitleTracks: [{ lang: 'en', name: 'English' }], subtitleTrack: -1 };
    const engine = hlsTrackEngine(hls);
    expect(engine.list().selected).toEqual({ audio: '0', subtitle: null });
    engine.select({ audio: '1', subtitle: '0' });
    expect(hls.audioTrack).toBe(1);
    expect(hls.subtitleTrack).toBe(0);
    expect(hls.subtitleDisplay).toBe(true);
    engine.select({ subtitle: 'off' });
    expect(hls.subtitleTrack).toBe(-1);
  });

  it('dash: uses dash.js track APIs', () => {
    const audio = [{ id: 'a1', lang: 'en', labels: [{ text: 'English' }] }, { id: 'a2', lang: 'de', labels: [] }];
    const api = {
      getTracksFor: (t) => (t === 'audio' ? audio : [{ index: 0, lang: 'en' }]),
      getCurrentTrackFor: () => audio[0],
      getCurrentTextTrackIndex: () => -1,
      setCurrentTrack: vi.fn(), setTextTrack: vi.fn(), enableText: vi.fn(),
    };
    const engine = dashTrackEngine(api);
    expect(engine.list().audio.map((t) => t.id)).toEqual(['a1', 'a2']);
    engine.select({ audio: 'a2', subtitle: '0' });
    expect(api.setCurrentTrack).toHaveBeenCalledWith(audio[1]);
    expect(api.setTextTrack).toHaveBeenCalledWith(0);
    expect(trackEngineFor({ kind: 'dash', api }).kind).toBe('dash');
    expect(trackEngineFor({ el: {} }).kind).toBe('native');
    expect(trackEngineFor(null)).toBeNull();
  });
});
