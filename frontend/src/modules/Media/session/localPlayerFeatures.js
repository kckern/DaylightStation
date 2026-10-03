// frontend/src/modules/Media/session/localPlayerFeatures.js
//
// Player features for playback on THIS device (P2): subtitles and audio
// language (RQ-STEER-14) and music behind a slideshow (RQ-PLAY-12). The same
// shapes a screen publishes in `snapshot.controls.tracks / .musicBehind`, so
// the controls are written once for both (PlayerFeatureControls).
//
//   PlayerBridge   binds the Player (setTracks) and reports its tracks
//   MusicBehindHost binds the music layer (command) and reports its state
import mediaLog from '../logging/mediaLog.js';

export function createLocalPlayerFeatures() {
  let state = { tracks: null, musicBehind: null };
  let player = null;
  let music = null;
  const listeners = new Set();
  const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* listener's problem */ } } };
  const set = (patch) => { state = { ...state, ...patch }; notify(); };

  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    setTrackState(tracks) {
      if (JSON.stringify(tracks ?? null) === JSON.stringify(state.tracks)) return;
      set({ tracks: tracks ?? null });
    },
    bindPlayer(handle) {
      player = handle;
      return () => { if (player === handle) player = null; };
    },
    async setTracks(selection) {
      mediaLog.playerFeature?.({ feature: 'tracks', action: 'select', target: 'local', ...selection });
      const result = player ? await player.setTracks(selection) : { ok: false, code: 'NO_PLAYBACK' };
      if (result?.ok === false) mediaLog.playerFeatureFailed?.({ feature: 'tracks', target: 'local', code: result.code ?? null });
      return result ?? { ok: false, code: 'NO_PLAYBACK' };
    },

    setMusicState(musicBehind) { set({ musicBehind: musicBehind ?? null }); },
    bindMusic(handle) {
      music = handle;
      return () => { if (music === handle) music = null; };
    },
    async musicBehind(op, params = {}) {
      mediaLog.playerFeature?.({ feature: 'music-behind', action: op, target: 'local', contentId: params.contentId ?? null });
      const result = music ? await music.command(op, params) : { ok: false, code: 'MUSIC_UNAVAILABLE' };
      if (result?.ok === false) mediaLog.playerFeatureFailed?.({ feature: 'music-behind', target: 'local', action: op, code: result.code ?? null });
      return result;
    },
  };
}

let singleton = null;
/** One per tab: the Media app has one local playback. */
export function getLocalPlayerFeatures() {
  if (!singleton) singleton = createLocalPlayerFeatures();
  return singleton;
}

/** Test helper. */
export function __resetLocalPlayerFeatures() { singleton = null; }
