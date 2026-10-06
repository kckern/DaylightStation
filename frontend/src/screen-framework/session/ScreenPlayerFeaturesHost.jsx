// frontend/src/screen-framework/session/ScreenPlayerFeaturesHost.jsx
//
// Binds the screen's player features (screenPlayerFeatures.js) to the mounted
// screen: claims the playback owner's Player for subtitles/audio language,
// starts and ends Show briefly, and runs the music layer behind a slideshow.
// Renders the brief surface (camera or clip over the paused programme, with
// what interrupted, from where, and when the programme comes back) and the
// music plaque.
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import { getPlayerQueueOpRegistry } from '../../modules/Player/lib/queueOpRegistry.js';
import { registerTrackOwner, createTrackPreferenceStore } from '../../modules/Player/lib/trackPolicy.js';
import { getPlayerSessionRegistry } from '../publishers/playerSessionRegistry.js';
import { isSlideshowItem } from '@shared-contracts/media/playerFeatures.mjs';
import { musicBehindVerdict } from '../../modules/Player/lib/musicBehindPolicy.js';
import Player from '../../modules/Player/Player.jsx';
import CameraOverlay from '../../modules/CameraFeed/CameraOverlay.jsx';
import { MusicBehindLayer } from '../../modules/Player/components/MusicBehindLayer.jsx';
import { requestRestore } from './ScreenSessionControlsHost.jsx';
import getLogger from '../../lib/logging/Logger.js';
import './ScreenPlayerFeatures.css';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenPlayerFeaturesHost' });
  return _logger;
}

// Starts that take the screen: a brief that was up is superseded, not returned from.
const SUPERSEDING_OPS = new Set(['play-now', 'item-action', 'jump']);

const humanizeCamera = (id) => String(id ?? 'Camera').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function useFeatureState(features) {
  const cache = useRef(null);
  const subscribe = useCallback((fn) => features.subscribe(() => { cache.current = null; fn(); }), [features]);
  const getState = useCallback(() => {
    if (!cache.current) cache.current = features.toPublished();
    return cache.current;
  }, [features]);
  return useSyncExternalStore(subscribe, getState);
}

export function ScreenPlayerFeaturesHost({ features, source }) {
  const ownerId = features?.ownerId ?? null;
  const musicRef = useRef(null);
  const [music, setMusic] = useState(null); // { contentId, title, shuffle }
  const musicRefState = useRef(null);
  musicRefState.current = music;
  // A person on another device chose "Keep music" when stopping the slideshow.
  const keepMusicRef = useRef(false);
  const preferences = useMemo(() => createTrackPreferenceStore({ namespace: `screen:${ownerId ?? 'unknown'}` }), [ownerId]);

  // --- Ports ------------------------------------------------------------------
  useEffect(() => {
    if (!features) return undefined;
    const ownerPlayer = () => getPlayerSessionRegistry().getCurrent()?.player ?? null;
    features.setPorts({
      getSnapshot: () => source?.getBareSnapshot?.() ?? source?.getSnapshot?.() ?? null,
      pausePlayback: () => getPlayerQueueOpRegistry().dispatch({ op: 'pause' }),
      resumePlayback: () => getPlayerQueueOpRegistry().dispatch({ op: 'play' }),
      restoreSnapshot: (snapshot, opts) => requestRestore(snapshot, opts),
      setTracks: (selection) => {
        const player = ownerPlayer();
        if (!player?.setTracks) return { ok: false, code: 'NO_PLAYBACK', error: 'Nothing is playing here' };
        return player.setTracks(selection);
      },
      stopMusic: () => { keepMusicRef.current = false; setMusic(null); features.setMusicState(null); },
      musicCommand: (op, params) => {
        const current = musicRefState.current;
        if (op === 'start') {
          const snapshot = source?.getBareSnapshot?.() ?? null;
          if (!isSlideshowItem(snapshot?.currentItem)) {
            return { ok: false, code: 'NOT_A_SLIDESHOW', error: 'Music behind needs a photo slideshow playing' };
          }
          keepMusicRef.current = false;
          setMusic({ contentId: params.contentId, title: params.title ?? null, startedAt: Date.now() });
          features.setMusicState({ contentId: params.contentId, title: params.title ?? null, state: 'loading' });
          return { ok: true };
        }
        if (!current) return { ok: false, code: 'NO_MUSIC', error: 'No music is playing behind' };
        if (op === 'stop') { setMusic(null); features.setMusicState(null); return { ok: true }; }
        const layer = musicRef.current;
        if (!layer) return { ok: false, code: 'MUSIC_LOADING', error: 'The music is still starting' };
        layer[op]?.();
        return { ok: true };
      },
    });
    // Subtitles and audio language: this screen claims only the Player its
    // session is bound to; every other Player on the page is untouched.
    const unregister = registerTrackOwner({
      isOwner: (instanceId) => !!instanceId && source?.getActionOwner?.()?.ownerInstanceId === instanceId,
      getPreference: (key) => preferences.get(key),
      setPreference: (key, value) => preferences.set(key, value),
      onTracks: (state) => features.setTrackState(state),
    });
    logger().info('mounted', { ownerId });
    return () => { unregister(); logger().info('unmounted', { ownerId }); };
  }, [features, source, preferences, ownerId]);

  // Nothing loaded → no tracks to offer.
  useEffect(() => {
    if (!features || !source?.subscribe) return undefined;
    const check = () => {
      const snapshot = source.getBareSnapshot?.();
      if (!snapshot?.currentItem && features.toPublished().tracks) features.setTrackState(null);
      // No double audio: music behind ends when the photos give way to
      // something with its own sound, or to nothing the person did not keep it over.
      if (musicRefState.current) {
        const verdict = musicBehindVerdict({ item: snapshot?.currentItem ?? null, state: snapshot?.state ?? null, keep: keepMusicRef.current });
        if (verdict === 'stop') {
          logger().info('music-behind.stop-with-slideshow', { ownerId, reason: snapshot?.currentItem ? 'not-an-image' : 'slideshow-gone' });
          keepMusicRef.current = false;
          setMusic(null);
          features.setMusicState(null);
        }
      }
    };
    return source.subscribe({ onChange: check, onStateTransition: check });
  }, [features, source, ownerId]);

  // --- Show briefly: start / supersede ------------------------------------------
  useEffect(() => {
    if (!features) return undefined;
    const bus = getActionBus();
    const onBrief = (payload = {}) => {
      const { commandId } = payload;
      const kind = payload.kind === 'camera' ? 'camera' : 'clip';
      if (payload.replace) {
        // A camera the routine said is NOT brief takes the screen.
        features.supersedeBrief('replace');
        getPlayerQueueOpRegistry().dispatch({ op: 'stop' });
      }
      const result = features.beginBrief({
        kind,
        contentId: payload.contentId ?? null,
        cameraId: payload.cameraId ?? null,
        title: payload.title ?? (kind === 'camera' ? humanizeCamera(payload.cameraId) : null),
        origin: payload.origin ?? null,
        seconds: payload.seconds ?? null,
        noReturn: !!payload.replace,
      });
      if (!commandId) return;
      if (result.ok) bus.emit('media:session-control-applied', { commandId, appliedAs: 'brief' });
      else bus.emit('command-handler-error', { commandId, code: result.code, error: result.code });
    };
    const supersede = (reason) => (payload = {}) => {
      if (reason === 'media:queue-op' && !SUPERSEDING_OPS.has(payload?.op)) return;
      if (reason === 'media:queue-op' && payload?.op === 'item-action'
        && !['playNow', 'shuffle'].includes(payload?.kind)) return;
      features.supersedeBrief(reason);
    };
    // A Stop brings every brief down (nothing returns). A Stop from a person
    // on another device already answered "Keep the music?" in the controls, so
    // it leaves the music; the TV remote, a routine and the sleep timer have
    // no such question and stop it too.
    const onPlayback = (payload = {}) => {
      if (String(payload?.command ?? '').toLowerCase() !== 'stop') return;
      const keep = payload.origin?.kind === 'device';
      if (keep && musicRefState.current) keepMusicRef.current = true;
      features.onPlaybackStopped('stop', { stopMusic: !keep });
    };
    const onDisplaySleep = () => features.onPlaybackStopped('display-sleep');
    const unsubs = [
      bus.subscribe('media:playback', onPlayback),
      bus.subscribe('display:sleep', onDisplaySleep),
      bus.subscribe('media:brief', onBrief),
      bus.subscribe('media:play', supersede('media:play')),
      bus.subscribe('media:queue', supersede('media:queue')),
      bus.subscribe('media:queue-op', supersede('media:queue-op')),
      bus.subscribe('media:adopt-snapshot', supersede('media:adopt-snapshot')),
    ];
    return () => unsubs.forEach((u) => u());
  }, [features]);

  useEffect(() => {
    if (!music) return undefined;
    logger().info('music-behind.started', { ownerId, contentId: music.contentId });
    return () => logger().info('music-behind.stopped', { ownerId, contentId: music.contentId });
  }, [music, ownerId]);

  const onMusicState = useCallback((state) => features?.setMusicState(state), [features]);
  const onMusicEnded = useCallback(() => {
    setMusic(null);
    features?.setMusicState(null);
  }, [features]);

  if (!features) return null;
  return (
    <>
      <ScreenBriefSurface features={features} />
      {music && (
        <MusicBehindLayer
          ref={musicRef}
          key={`${music.contentId}:${music.startedAt}`}
          contentId={music.contentId}
          title={music.title}
          onState={onMusicState}
          onEnded={onMusicEnded}
        />
      )}
      <ScreenMusicPlaque features={features} />
    </>
  );
}

function useTick(active) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

export function ScreenBriefSurface({ features }) {
  const state = useFeatureState(features);
  const brief = state.brief;
  useTick(!!brief?.endsAt);

  const close = useCallback(() => { features.endBrief('closed'); }, [features]);
  const ended = useCallback(() => { features.endBrief('ended'); }, [features]);
  // Stable per brief: a fresh `play` object each tick would remount the clip.
  const clipPlay = useMemo(() => (brief?.contentId ? { contentId: brief.contentId } : null), [brief?.id, brief?.contentId]); // eslint-disable-line react-hooks/exhaustive-deps
  // While something is shown briefly, Back closes it and returns the programme.
  useEffect(() => {
    if (!brief) return undefined;
    return getActionBus().capture(['escape'], () => { close(); return true; });
  }, [!!brief, close]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!brief) return null;
  const remaining = brief.endsAt ? Math.max(0, Math.ceil((Date.parse(brief.endsAt) - Date.now()) / 1000)) : null;
  return (
    <div className="screen-brief" data-testid="screen-brief" data-brief-kind={brief.kind}>
      <div className="screen-brief__content">
        {brief.kind === 'camera'
          ? <CameraOverlay cameraId={brief.cameraId ?? undefined} dismiss={close} />
          : (
            <Player
              key={brief.id}
              auxiliary
              ignoreKeys
              play={clipPlay}
              clear={ended}
            />
          )}
      </div>
      <div className="screen-brief__bar" role="status" aria-live="polite">
        <span className="screen-brief__label" data-testid="screen-brief-label">{brief.label}</span>
        {brief.returnTo && (
          <span className="screen-brief__return" aria-live="off" data-testid="screen-brief-return">
            {`Back to ${brief.returnTo.title ?? 'your programme'}${remaining != null ? ` in ${remaining}s`
              : brief.kind === 'clip' ? ' after this' : ' when closed'}`}
          </span>
        )}
        {!brief.returnTo && remaining != null && (
          <span className="screen-brief__return" aria-live="off" data-testid="screen-brief-return">{`Closes in ${remaining}s`}</span>
        )}
        <button type="button" className="screen-brief__close" data-testid="screen-brief-close" onClick={close}>Close</button>
      </div>
    </div>
  );
}

function ScreenMusicPlaque({ features }) {
  const state = useFeatureState(features);
  const music = state.musicBehind;
  if (!music) return null;
  return (
    <div className="screen-music-plaque" role="status" data-testid="screen-music-plaque" data-music-state={music.state}>
      <span className="screen-music-plaque__mark" aria-hidden="true">♪</span>
      <span>{music.trackTitle ?? music.title ?? 'Music'}</span>
      {music.state === 'paused' && <span className="screen-music-plaque__state">Paused</span>}
    </div>
  );
}

export default ScreenPlayerFeaturesHost;
