import { describe, it, expect } from 'vitest';
import {
  PLAYER_FEATURE_ACTIONS, SUBTITLES_OFF, BRIEF_DEFAULT_SECONDS,
  validatePlayerFeatureParams, plexTracksFromMetadata, trackPreferenceKey,
  matchTrack, selectionForPreference, preferenceFromSelection, plexStreamParams,
  withStreamParams, parseStreamParams, resolveBriefMode, briefLabel,
  validatePlayerFeatureControls, isSlideshowItem,
} from './playerFeatures.mjs';
import { SESSION_ACTIONS, validateSessionActionParams, validateSessionControls, createDefaultSessionControls } from './sessionControls.mjs';

// Real stream metadata shape (Plex /library/metadata, abbreviated): one English
// audio track, forced + full English subtitles and a Greek one.
const episode = (overrides = {}) => ({
  type: 'episode', grandparentId: '665636', grandparentType: 'show',
  Media: [{ Part: [{ id: 729273, Stream: [
    { id: 1278355, streamType: 1, codec: 'h264' },
    { id: 1278356, streamType: 2, languageCode: 'eng', displayTitle: 'English (EAC3 5.1)', selected: true },
    { id: 1278357, streamType: 3, languageCode: 'eng', displayTitle: 'English Forced', forced: true },
    { id: 1278358, streamType: 3, languageCode: 'eng', displayTitle: 'English' },
    { id: 1278377, streamType: 3, languageCode: 'ell', displayTitle: 'Ελληνικά' },
    ...(overrides.extra ?? []),
  ] }] }],
  ...overrides.meta,
});

describe('player feature session actions', () => {
  it('are part of the session action vocabulary', () => {
    for (const action of PLAYER_FEATURE_ACTIONS) expect(SESSION_ACTIONS).toContain(action);
  });

  it('validate set-tracks params', () => {
    expect(validateSessionActionParams({ action: 'set-tracks', subtitle: '1278358' }).valid).toBe(true);
    expect(validateSessionActionParams({ action: 'set-tracks', subtitle: SUBTITLES_OFF }).valid).toBe(true);
    expect(validateSessionActionParams({ action: 'set-tracks', audio: '1' }).valid).toBe(true);
    expect(validateSessionActionParams({ action: 'set-tracks' }).valid).toBe(false);
    expect(validateSessionActionParams({ action: 'set-tracks', audio: 3 }).valid).toBe(false);
  });

  it('validate music-behind params', () => {
    expect(validateSessionActionParams({ action: 'music-behind', op: 'start', contentId: 'plex:1' }).valid).toBe(true);
    expect(validateSessionActionParams({ action: 'music-behind', op: 'start' }).valid).toBe(false);
    expect(validateSessionActionParams({ action: 'music-behind', op: 'next' }).valid).toBe(true);
    expect(validateSessionActionParams({ action: 'music-behind', op: 'rewind' }).valid).toBe(false);
    expect(validateSessionActionParams({ action: 'close-brief' }).valid).toBe(true);
    expect(validatePlayerFeatureParams({ action: 'sleep-timer' })).toBeNull();
  });
});

describe('tracks from Plex stream metadata (STEER.12a/AC2)', () => {
  it('offers only the tracks the item has', () => {
    const tracks = plexTracksFromMetadata(episode());
    expect(tracks.audio.map((t) => t.id)).toEqual(['1278356']);
    expect(tracks.subtitles.map((t) => [t.id, t.language, t.label])).toEqual([
      ['1278357', 'eng', 'English Forced'], ['1278358', 'eng', 'English'], ['1278377', 'ell', 'Ελληνικά'],
    ]);
    expect(tracks.selected).toEqual({ audio: '1278356', subtitle: null });
  });

  it('is null for an item without streams', () => {
    expect(plexTracksFromMetadata({ Media: [{ Part: [{ Stream: [{ id: 1, streamType: 1 }] }] }] })).toBeNull();
    expect(plexTracksFromMetadata({})).toBeNull();
  });

  it('keys a choice by show for episodes, by item otherwise (AC3)', () => {
    expect(trackPreferenceKey({ contentId: 'plex:665638', metadata: episode() })).toBe('show:665636');
    expect(trackPreferenceKey({ contentId: 'plex:56069', metadata: { type: 'movie' } })).toBe('item:plex:56069');
  });

  it('carries a choice to another episode by language and label', () => {
    const ep1 = plexTracksFromMetadata(episode());
    const pref = preferenceFromSelection(ep1, { subtitle: '1278358' });
    expect(pref).toEqual({ subtitle: { language: 'eng', label: 'English' } });
    // Episode 2: same languages, different stream ids.
    const ep2 = plexTracksFromMetadata({ ...episode(), Media: [{ Part: [{ Stream: [
      { id: 2, streamType: 2, languageCode: 'eng', displayTitle: 'English', selected: true },
      { id: 3, streamType: 3, languageCode: 'eng', displayTitle: 'English Forced', forced: true },
      { id: 4, streamType: 3, languageCode: 'eng', displayTitle: 'English' },
    ] }] }] });
    expect(selectionForPreference(ep2, pref)).toEqual({ subtitle: '4' });
  });

  it('prefers a non-forced track when only the language matches', () => {
    const tracks = [{ id: 'f', language: 'eng', label: 'Eng F', forced: true }, { id: 'n', language: 'eng', label: 'Eng' }];
    expect(matchTrack(tracks, { language: 'eng', label: 'English SDH' }).id).toBe('n');
  });

  it('asks for "off" only when a subtitle is selected', () => {
    const tracks = plexTracksFromMetadata(episode());
    expect(selectionForPreference(tracks, { subtitle: SUBTITLES_OFF })).toBeNull();
    const withSelected = { ...tracks, selected: { ...tracks.selected, subtitle: '1278358' } };
    expect(selectionForPreference(withSelected, { subtitle: SUBTITLES_OFF })).toEqual({ subtitle: 'off' });
  });

  it('ignores an audio preference when there is nothing to choose', () => {
    const tracks = plexTracksFromMetadata(episode());
    expect(selectionForPreference(tracks, { audio: { language: 'jpn', label: 'Japanese' } })).toBeNull();
  });

  it('builds and parses the stream-mint params', () => {
    expect(plexStreamParams({ audio: '7', subtitle: 'off' })).toEqual({ audioStreamID: '7', subtitleStreamID: '0' });
    expect(plexStreamParams({})).toBeNull();
    const url = withStreamParams('/api/v1/proxy/plex/stream/665638?offset=12&session=s1', { subtitleStreamID: '1278358' });
    expect(url).toBe('/api/v1/proxy/plex/stream/665638?offset=12&session=s1&subtitleStreamID=1278358');
    expect(withStreamParams('/x', null)).toBe('/x');
    expect(parseStreamParams({ subtitleStreamID: '1278358' })).toEqual({ subtitleStreamId: '1278358' });
    expect(parseStreamParams({ subtitleStreamID: '0', audioStreamID: 'x' })).toEqual({ subtitleStreamId: '0' });
    expect(parseStreamParams({})).toBeNull();
  });
});

describe('Show briefly mode (PLAY.8b)', () => {
  it('routine camera starts are brief unless the routine says otherwise', () => {
    const routine = { kind: 'routine', name: 'Doorbell' };
    expect(resolveBriefMode({ kind: 'camera', origin: routine })).toEqual({ brief: true, seconds: BRIEF_DEFAULT_SECONDS });
    expect(resolveBriefMode({ kind: 'camera', origin: routine, brief: '0' })).toEqual({ brief: false, seconds: null });
    expect(resolveBriefMode({ kind: 'camera', origin: routine, brief: '45' })).toEqual({ brief: true, seconds: 45 });
  });

  it('anything else is brief only when asked', () => {
    expect(resolveBriefMode({ kind: 'camera', origin: { kind: 'device', id: 'browser:x' } })).toEqual({ brief: false, seconds: null });
    expect(resolveBriefMode({ kind: 'clip', origin: { kind: 'routine', name: 'R' } })).toEqual({ brief: false, seconds: null });
    expect(resolveBriefMode({ kind: 'clip', brief: '1' })).toEqual({ brief: true, seconds: null });
    expect(resolveBriefMode({ kind: 'clip', brief: '1', briefSeconds: '20' })).toEqual({ brief: true, seconds: 20 });
    expect(resolveBriefMode({ kind: 'camera', brief: 'true' })).toEqual({ brief: true, seconds: BRIEF_DEFAULT_SECONDS });
  });

  it('labels what interrupted and where it came from (PLAY.8a/AC3)', () => {
    expect(briefLabel({ title: 'Front door', originName: 'Doorbell' })).toBe('Front door · from Doorbell');
    expect(briefLabel({ title: 'Front door' })).toBe('Front door');
  });
});

describe('published player feature controls', () => {
  it('accepts the three blocks and the idle defaults', () => {
    const controls = {
      ...createDefaultSessionControls(),
      tracks: { contentId: 'plex:1', audio: [{ id: '1', label: 'English' }], subtitles: [], selected: { audio: '1', subtitle: null } },
      brief: { kind: 'camera', label: 'Front door · from Doorbell', endsAt: '2026-10-03T00:00:30.000Z', remainingSeconds: 30 },
      musicBehind: { contentId: 'plex:9', title: 'Album', state: 'playing' },
    };
    expect(validatePlayerFeatureControls(controls)).toEqual({ valid: true, errors: [] });
    expect(validateSessionControls(controls).valid).toBe(true);
    expect(validateSessionControls(createDefaultSessionControls()).valid).toBe(true);
  });

  it('rejects malformed blocks', () => {
    const bad = { ...createDefaultSessionControls(), brief: { kind: 'tv', label: '' }, musicBehind: { state: 'x' } };
    const checked = validateSessionControls(bad);
    expect(checked.valid).toBe(false);
    expect(checked.errors.join(' ')).toMatch(/brief.kind/);
    expect(checked.errors.join(' ')).toMatch(/musicBehind.contentId/);
  });

  it('knows a slideshow item', () => {
    expect(isSlideshowItem({ format: 'image' })).toBe(true);
    expect(isSlideshowItem({ mediaType: 'image' })).toBe(true);
    expect(isSlideshowItem({ format: 'video' })).toBe(false);
  });
});
