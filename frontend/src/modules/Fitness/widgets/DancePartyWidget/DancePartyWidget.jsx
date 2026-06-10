import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import Player from '@/modules/Player/Player.jsx';
import { ContentDisplayUrl } from '@/lib/api.mjs';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import { resolveDancePlaylists } from './resolveDancePlaylists.js';
import { muteVideosIn } from './muteVideosIn.js';
import { useDanceLighting } from './useDanceLighting.js';
import DanceNowPlayingBar from './DanceNowPlayingBar.jsx';
import { usePersistentVolume } from '../../nav/usePersistentVolume.js';
import { snapToTouchLevel, linearVolumeFromLevel, linearLevelFromVolume } from '../../player/panels/TouchVolumeButtons.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './DancePartyWidget.scss';

/**
 * DancePartyWidget — fullscreen "Party Mode": a looping muted disco video
 * (or animated CSS backdrop when no video is configured) + a shuffled music
 * playlist, with the garage Hue strips driven by useDanceLighting (start on
 * mount, stop on unmount, accent on each track change).
 *
 * The two <Player> instances mirror the real call site in
 * FitnessMusicPlayer.jsx: a memoized `queue` object, the forwardRef `ref`,
 * track detection via the `onProgress` callback's `progressData.media`, and
 * the imperative API (`toggle`, `advance`, `getMediaElement`). The video is
 * looped via `queue.continuous` and muted by forcing `<video>.muted = true`
 * directly (via muteVideosIn — `play={{ volume: 0 }}` is a no-op because
 * useQueueController resolves `play?.volume || ... || 1` and 0 is falsy).
 */
export default function DancePartyWidget({ onClose, config, onMount }) {
  const logger = useMemo(() => getLogger().child({ component: 'dance-party' }), []);
  const fitnessContext = useFitnessContext();
  // Single source of truth: the dance_party block from FitnessContext. The
  // host's `config` prop is only honored when it explicitly carries its own
  // dance_party block (e.g. unit tests) — never merged, never substituted.
  const dancePartyConfig = config?.dance_party ?? fitnessContext?.dancePartyConfig ?? null;
  const { configured, audioPlaylistId, videoPlaylistId, shuffle, hasVideo, videoShader } =
    useMemo(() => resolveDancePlaylists(dancePartyConfig), [dancePartyConfig]);

  const { accent } = useDanceLighting({ enabled: true });

  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const [track, setTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const trackKeyRef = useRef(null);

  // Notify the host container we've mounted (parity with other widgets).
  useEffect(() => {
    onMount?.();
  }, [onMount]);

  // Make the resolved config visible in session logs; an unconfigured or
  // id-less dance_party is a config/plumbing failure, not a fallback case.
  useEffect(() => {
    if (!configured) {
      logger.error('fitness.dance.config_missing', {
        hint: 'dance_party block not found in fitness config (check FitnessContext.dancePartyConfig plumbing)'
      });
      return;
    }
    logger.info('fitness.dance.config_resolved', { audioPlaylistId, videoPlaylistId, shuffle, hasVideo });
    if (!audioPlaylistId) {
      logger.error('fitness.dance.audio_unconfigured', { dancePartyConfig });
    }
  }, [configured, audioPlaylistId, videoPlaylistId, shuffle, hasVideo, dancePartyConfig, logger]);

  // Mirror FitnessMusicPlayer: the queue prop is a memoized object so the inner
  // Player's queue controller does not re-init every render.
  const audioQueue = useMemo(
    () => (audioPlaylistId ? { contentId: `plex:${audioPlaylistId}`, plex: audioPlaylistId, shuffle } : null),
    [audioPlaylistId, shuffle]
  );
  // continuous: true loops the playlist (see useQueueController reset-continuous).
  // shader rides the queue object — Player resolves play?.shader || queue?.shader.
  const videoQueue = useMemo(
    () => (videoPlaylistId ? { contentId: `plex:${videoPlaylistId}`, plex: videoPlaylistId, shuffle, continuous: true, shader: videoShader } : null),
    [videoPlaylistId, shuffle, videoShader]
  );
  // Mute the video layer at the element level. Player has no `muted` prop and
  // `play={{ volume: 0 }}` is a no-op (useQueueController: `play?.volume || 1`).
  // The MutationObserver in muteVideosIn keeps the <video> muted as the
  // `continuous` playlist swaps the source/element on each advance.
  useEffect(() => {
    if (!(hasVideo && videoQueue)) return undefined;
    const cleanup = muteVideosIn(videoContainerRef.current);
    return cleanup;
  }, [hasVideo, videoQueue]);

  // Track changes arrive via Player's onProgress callback (progressData.media),
  // exactly as FitnessMusicPlayer derives its current track. Fire a lighting
  // accent + update the now-playing bar only when the track key actually changes.
  const handleAudioProgress = useCallback((progressData) => {
    const media = progressData?.media;
    if (!media) return;
    const newKey = media.contentId || media.key || media.plex || media.assetId || media.ratingKey || null;
    if (newKey && newKey !== trackKeyRef.current) {
      const isFirstTrack = trackKeyRef.current == null;
      trackKeyRef.current = newKey;
      setTrack({
        key: newKey,
        title: media.title || media.label || media.parentTitle || null,
        artist: media.artist || media.albumArtist || media.grandparentTitle || media.parentTitle || null,
        coverUrl: newKey ? ContentDisplayUrl(newKey) : null
      });
      accent();
      logger.info('fitness.dance.track_change', { title: media.title || null });
      // New song → new visual: advance the video layer in step with the music.
      // Skip the initial track so the video doesn't jump right at mount.
      if (!isFirstTrack && videoRef.current?.advance) {
        videoRef.current.advance(1);
        logger.debug('fitness.dance.video_advance_on_track_change', {});
      }
    }
  }, [accent, logger]);

  const handleAudioError = useCallback((err) => {
    logger.warn('fitness.dance.audio_error', { kind: err?.kind ?? null, message: err?.message ?? null });
  }, [logger]);

  // Video-layer observability: log the first frame source and any errors so
  // a silent video layer is diagnosable from session logs.
  const videoKeyRef = useRef(null);
  const handleVideoProgress = useCallback((progressData) => {
    const media = progressData?.media;
    if (!media) return;
    const key = media.contentId || media.key || media.plex || media.ratingKey || null;
    if (key && key !== videoKeyRef.current) {
      videoKeyRef.current = key;
      logger.info('fitness.dance.video_started', { title: media.title || null, contentId: key });
    }
  }, [logger]);

  const handleVideoError = useCallback((err) => {
    logger.warn('fitness.dance.video_error', { kind: err?.kind ?? null, message: err?.message ?? null });
  }, [logger]);

  const togglePlay = useCallback(() => {
    const api = audioRef.current;
    if (!api || typeof api.toggle !== 'function') return;
    api.toggle();
    setIsPlaying((prev) => !prev);
  }, []);

  const next = useCallback(() => {
    audioRef.current?.advance?.(1);
  }, []);

  // Persistent volume (VolumeProvider store): survives exits/reloads, scoped
  // to the dance audio playlist. The current track key in the ids makes the
  // hook re-apply the stored level whenever the audio element swaps on track
  // change. TouchVolumeButtons levels (0-100 in tens, 0 = mute) ↔ linear 0-1.
  const volumeState = usePersistentVolume({
    grandparentId: 'fitness-dance',
    parentId: audioPlaylistId != null ? String(audioPlaylistId) : 'global',
    trackId: track?.key || 'dance',
    playerRef: audioRef
  });
  const volumeLevel = snapToTouchLevel(linearLevelFromVolume(volumeState.muted ? 0 : volumeState.volume));
  const handleVolumeSelect = useCallback((level) => {
    volumeState.setVolume(linearVolumeFromLevel(level));
    logger.info('fitness.dance.volume_select', { level });
  }, [volumeState, logger]);

  // Press the video → fullscreen party: the widget root escapes the app frame
  // (fixed overlay over the fitness sidebar/chrome); press again to restore.
  // The now-playing bar stays visible in both states.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      logger.info('fitness.dance.fullscreen_toggle', { fullscreen: !prev });
      return !prev;
    });
  }, [logger]);

  return (
    <div className={`dance-party${isFullscreen ? ' is-fullscreen' : ''}`}>
      <div className="dance-video" ref={videoContainerRef}>
        {hasVideo && videoQueue ? (
          <Player ref={videoRef} queue={videoQueue} playerType="video" onProgress={handleVideoProgress} onError={handleVideoError} />
        ) : (
          <div className="dance-backdrop" aria-hidden="true" />
        )}
      </div>

      <button
        type="button"
        className="dance-tapzone"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onClick={toggleFullscreen}
      />

      {audioQueue && (
        <div className="dance-audio-host">
          <Player
            ref={audioRef}
            queue={audioQueue}
            onProgress={handleAudioProgress}
            onError={handleAudioError}
            playerType="audio"
          />
        </div>
      )}

      <DanceNowPlayingBar
        track={track}
        isPlaying={isPlaying}
        onPlayPause={togglePlay}
        onNext={next}
        onExit={onClose}
        volumeLevel={volumeLevel}
        onVolumeSelect={handleVolumeSelect}
      />
    </div>
  );
}

DancePartyWidget.propTypes = {
  onClose: PropTypes.func,
  config: PropTypes.object,
  onMount: PropTypes.func
};
