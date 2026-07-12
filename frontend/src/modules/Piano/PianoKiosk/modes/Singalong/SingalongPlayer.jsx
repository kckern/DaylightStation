// SingalongPlayer.jsx
import { useRef, useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import usePlayerController from '../../../../Player/usePlayerController.js';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoMix } from '../../PianoMixContext.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import PlayerBoundary from '../Videos/PlayerBoundary.jsx';
import useResolvedMediaEl from '../Videos/useResolvedMediaEl.js';
import usePauseMediaOnUnmount from '../Videos/usePauseMediaOnUnmount.js';
import usePianoWatchLog from '../Videos/usePianoWatchLog.js';
import { lectureContentId, deriveResumeSeconds } from '../Videos/lectureMeta.js';
import { videoTapAction, TAP_SKIP_SECONDS } from '../Videos/videoTapAction.js';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import useReloadGuard from '../../useReloadGuard.js';
import Icon from '../../icons/Icon.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';

// Player is heavy — code-split it so the menu/other modes don't pay for it.
const Player = lazy(() => import('../../../../Player/Player.jsx'));

const fmt = (s) => {
  const v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
};

const VOL_STEP = 0.1;

/**
 * SingalongPlayer — a karaoke-flavoured lecture player. Reuses the Videos media
 * wiring (Player, resume, watch log) but drops every play-along affordance: no
 * keyboard, no staff, no circle of fifths, no MIDI. The video fills the stage and
 * a compact karaoke transport (restart · skip · play/pause · media volume ·
 * fullscreen) sits beneath it. Prop-compatible with PianoVideoPlayer so it drops
 * into the Videos grid→detail→player flow (see Singalong.jsx). `isSequential` and
 * `engagementTimeoutSeconds` are accepted for that contract but unused — karaoke
 * has no sequential lock or engagement gate.
 */
export default function SingalongPlayer({ lecture, source, onBack, startFresh = false }) {
  const playerRef = useRef(null);
  const ctrl = usePlayerController(playerRef);
  const { el: mediaEl, timedOut } = useResolvedMediaEl(playerRef);
  usePauseMediaOnUnmount(mediaEl);
  const ctrlPause = ctrl.pause;
  useEffect(() => () => {
    try { ctrlPause?.(); } catch { /* torn down */ }
    try { playerRef.current?.getMediaElement?.()?.pause?.(); } catch { /* torn down */ }
  }, [ctrlPause]);

  const { mediaLevel, setMediaLevel } = usePianoMix();
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const contentId = lectureContentId(lecture);
  const title = lecture?.label || lecture?.title || '';
  // startFresh (karaoke & play-along): a song/backing track has no resume concept —
  // always start at 0. Otherwise resume from the saved playhead like a lecture.
  const resumeSeconds = startFresh
    ? 0
    : (lecture?.userPlayhead != null ? lecture.userPlayhead : deriveResumeSeconds(lecture));
  const { currentUser } = usePianoUser();
  const engagedRef = useRef(true); // karaoke: opening the song counts as engaged

  // Header breadcrumb: the source collection (tap → back) › this song.
  usePianoBreadcrumb(useMemo(() => [
    ...(source ? [{ label: source, onClick: onBack }] : []),
    ...(title ? [{ label: title }] : []),
  ], [source, title, onBack]));
  usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds, userId: currentUser, engagedRef });
  useReloadGuard(isPlaying);

  // Memoize the heavy Player element so timeupdate ticks don't recreate (remount) it.
  const playerEl = useMemo(() => (
    <PlayerBoundary onBack={onBack}>
      <Suspense fallback={<SkeletonStage />}>
        {/* Karaoke/play-along NEVER resume — always start from the top. `resume:false`
            tells the backend to return NO resume_position (api.js → ?resume=false), so
            there's nothing for the Player's recovery-seek to fall back to (that chain
            treats an explicit seconds:0 as falsy and would otherwise re-grab the Plex
            viewOffset). `seconds:0` stays as belt-and-suspenders. Lectures (startFresh
            false) omit both, so their resume is unchanged. */}
        <Player
          ref={playerRef}
          play={startFresh
            ? { contentId, shader: 'focused', seconds: 0, resume: false }
            : { contentId, shader: 'focused' }}
          clear={onBack}
        />
      </Suspense>
    </PlayerBoundary>
  ), [contentId, onBack, startFresh]);

  // Fullscreen (mirrors PianoVideoPlayer): entered from the chrome button; a bare
  // tap in fullscreen just toggles pause here (no play-along overlay to summon).
  const videoWrapRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    const el = videoWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const { setPlaying: setGlobalPlaying, setVideoActive } = usePianoPlayback();
  useEffect(() => {
    setGlobalPlaying(isPlaying);
    return () => setGlobalPlaying(false);
  }, [isPlaying, setGlobalPlaying]);
  useEffect(() => {
    setVideoActive(true);
    return () => setVideoActive(false);
  }, [setVideoActive]);

  // Keep the tablet screen awake while a song is actively playing.
  useKeepScreenAwake('video', isPlaying);

  useEffect(() => {
    getLogger().child({ component: 'piano-singalong-player' }).info('piano.singalong.open', { contentId, resumeSeconds });
  }, [contentId, resumeSeconds]);

  // Mirror media-element state into React for the chrome.
  useEffect(() => {
    if (!mediaEl) return undefined;
    const onTime = () => setCurrentTime(mediaEl.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onMeta = () => setDuration(mediaEl.duration || 0);
    mediaEl.addEventListener('timeupdate', onTime);
    mediaEl.addEventListener('play', onPlay);
    mediaEl.addEventListener('pause', onPause);
    mediaEl.addEventListener('loadedmetadata', onMeta);
    onMeta();
    return () => {
      mediaEl.removeEventListener('timeupdate', onTime);
      mediaEl.removeEventListener('play', onPlay);
      mediaEl.removeEventListener('pause', onPause);
      mediaEl.removeEventListener('loadedmetadata', onMeta);
    };
  }, [mediaEl]);

  // Apply the shared media level to the resolved element.
  useEffect(() => { if (mediaEl) mediaEl.volume = mediaLevel; }, [mediaEl, mediaLevel]);

  const handleRestart = useCallback(() => ctrl.seek(0), [ctrl]);
  const handleSkip = useCallback((delta) => {
    const cur = ctrl.getCurrentTime() || 0;
    const max = duration > 0 ? duration : cur + Math.abs(delta);
    ctrl.seek(Math.max(0, Math.min(max, cur + delta)));
  }, [ctrl, duration]);

  // Bare tap on the video: left third −15s · middle toggles pause · right third +15s.
  const handleSurfaceTap = useCallback((e) => {
    const rect = videoWrapRef.current?.getBoundingClientRect();
    const action = videoTapAction((e.clientX ?? 0) - (rect?.left ?? 0), rect?.width ?? 0);
    if (action === 'back') handleSkip(-TAP_SKIP_SECONDS);
    else if (action === 'forward') handleSkip(TAP_SKIP_SECONDS);
    else ctrl.toggle();
  }, [handleSkip, ctrl]);

  const barRef = useRef(null);
  const dur = duration > 0 ? duration : 0;
  const pct = dur ? Math.min(100, (currentTime / dur) * 100) : 0;
  const seekFromEvent = useCallback((e) => {
    const el = barRef.current;
    if (!el || !dur) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    ctrl.seek(Math.max(0, Math.min(dur, (x / rect.width) * dur)));
  }, [ctrl, dur]);

  if (!contentId) {
    return (
      <div className="piano-mode__placeholder">
        This song can’t be played. <button type="button" onClick={onBack}>Back</button>
      </div>
    );
  }
  if (timedOut && !mediaEl) {
    getLogger().child({ component: 'piano-singalong-player' }).warn('piano.singalong.mount-timeout', { contentId });
    return (
      <div className="piano-mode__placeholder">
        This song didn’t start. <button type="button" onClick={onBack}>Back</button>
      </div>
    );
  }

  return (
    <div className="piano-singalong-player">
      <div
        className="piano-singalong-player__video"
        ref={videoWrapRef}
        onClick={handleSurfaceTap}
        style={{ position: 'relative' }}
      >
        {playerEl}
      </div>

      {/* Karaoke transport — no play-along controls, no rate/loop clutter. */}
      <div className="piano-singalong-chrome" data-testid="piano-singalong-chrome">
        <div className="piano-singalong-chrome__bar" ref={barRef} onPointerDown={seekFromEvent}>
          <div className="piano-singalong-chrome__progress" style={{ width: `${pct}%` }} />
        </div>
        <div className="piano-singalong-chrome__row">
          <button type="button" className="piano-singalong-chrome__btn" onClick={handleRestart} aria-label="Restart from beginning"><Icon name="previous" /></button>
          <span className="piano-singalong-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>
          <div className="piano-singalong-chrome__spacer" />
          <button type="button" className="piano-singalong-chrome__btn" onClick={() => handleSkip(-15)} aria-label="Back 15 seconds"><Icon name="skip-back-15" /></button>
          <button type="button" className="piano-singalong-chrome__btn piano-singalong-chrome__btn--play" onClick={ctrl.toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
          <button type="button" className="piano-singalong-chrome__btn" onClick={() => handleSkip(15)} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /></button>
          <div className="piano-singalong-chrome__spacer" />
          <button type="button" className="piano-singalong-chrome__btn" onClick={() => setMediaLevel(mediaLevel - VOL_STEP)} aria-label="Volume down"><Icon name="volume-down" /></button>
          <span className="piano-singalong-chrome__vol">{Math.round((mediaLevel ?? 0) * 100)}</span>
          <button type="button" className="piano-singalong-chrome__btn" onClick={() => setMediaLevel(mediaLevel + VOL_STEP)} aria-label="Volume up"><Icon name="volume-up" /></button>
          <button type="button" className="piano-singalong-chrome__btn piano-singalong-chrome__btn--fullscreen" onClick={toggleFullscreen} aria-label="Toggle fullscreen"><Icon name={isFullscreen ? 'fullscreen-exit' : 'fullscreen'} /></button>
        </div>
      </div>
    </div>
  );
}
