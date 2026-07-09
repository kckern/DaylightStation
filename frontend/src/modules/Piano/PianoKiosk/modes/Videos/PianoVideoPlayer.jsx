// PianoVideoPlayer.jsx
import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import usePlayerController from '../../../../Player/usePlayerController.js';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoMix } from '../../PianoMixContext.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { TheoryPanel } from '../../../components/TheoryPanel.jsx';
import PlayerBoundary from './PlayerBoundary.jsx';
import PianoVideoChrome from './PianoVideoChrome.jsx';
import useResolvedMediaEl from './useResolvedMediaEl.js';
import PausedLoopOverlay from './PausedLoopOverlay.jsx';
import usePauseMediaOnUnmount from './usePauseMediaOnUnmount.js';
import useABLoop from './useABLoop.js';
import usePianoWatchLog from './usePianoWatchLog.js';
import { nextPianoRate } from './pianoPlaybackRate.js';
import { lectureContentId, deriveResumeSeconds } from './lectureMeta.js';
import useReloadGuard from '../../useReloadGuard.js';
import EngagementGate from './EngagementGate.jsx';
import { useEngagementGate } from './useEngagementGate.js';
import { usePianoUser } from '../../PianoUserContext.jsx';

// Player is heavy — code-split it so the menu/other modes don't pay for it.
const Player = lazy(() => import('../../../../Player/Player.jsx'));

const EMPTY_NOTES = new Map();

/** Custom student video player for a single piano lecture, with MIDI play-along. */
export default function PianoVideoPlayer({ lecture, source, onBack, isSequential = false, engagementTimeoutSeconds = 90 }) {
  const playerRef = useRef(null);
  const ctrl = usePlayerController(playerRef);
  const { el: mediaEl, timedOut } = useResolvedMediaEl(playerRef);
  usePauseMediaOnUnmount(mediaEl);
  const { pressNote, releaseNote } = usePianoMidi();
  const { activeNotes } = usePianoMidiNotes();
  const { mediaLevel } = usePianoMix();
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [aspect, setAspect] = useState(16 / 9); // intrinsic video AR → sizes the box (no pillarbox)
  const bodyRef = useRef(null);
  const [stackW, setStackW] = useState(null);   // px width of the video+controls column

  // Size the left column to exactly the video's aspect at the available height, so
  // the contained video fills it edge-to-edge (no pillar bars) and the staff gets
  // ALL the remaining width. Recomputed on aspect change and on resize.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    const compute = () => {
      const chrome = body.querySelector('.piano-video-chrome');
      const H = body.clientHeight;
      const C = chrome ? chrome.offsetHeight : 0;
      const vidH = Math.max(0, H - C);
      const maxW = body.clientWidth - 200; // keep a usable minimum staff width
      setStackW(Math.round(Math.min(vidH * aspect, maxW)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(body);
    return () => ro.disconnect();
  }, [aspect]);

  const contentId = lectureContentId(lecture);
  const title = lecture?.label || lecture?.title || '';
  const resumeSeconds = lecture?.userPlayhead != null ? lecture.userPlayhead : deriveResumeSeconds(lecture);

  const { currentUser } = usePianoUser();
  const engagedRef = useRef(false);
  const [furthestWatched, setFurthestWatched] = useState(resumeSeconds || 0);

  // Engagement for completion = ANY play-along. Once the student presses any key
  // this session, the lecture counts as engaged (the inactivity gate's note also
  // lands here). engagedRef is read at each play/log post (Part 2).
  useEffect(() => {
    if (activeNotes && activeNotes.size > 0) engagedRef.current = true;
  }, [activeNotes]);

  const { gateOpen, dismissGate } = useEngagementGate({
    pause: ctrl.pause,
    play: ctrl.play,
    isPaused: () => !isPlaying,
    isSequential,
    timeoutSeconds: engagementTimeoutSeconds,
    onEngagementConfirmed: () => { engagedRef.current = true; },
  });

  // Header breadcrumb: the source show (tap → back to the course) › this lecture.
  usePianoBreadcrumb(useMemo(() => [
    ...(source ? [{ label: source, onClick: onBack }] : []),
    ...(title ? [{ label: title }] : []),
  ], [source, title, onBack]));
  const loop = useABLoop(mediaEl, ctrl.seek, ctrl.getCurrentTime);
  usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds, userId: currentUser, engagedRef });
  useReloadGuard(isPlaying);

  // Memoize the heavy Player element so high-frequency re-renders (timeupdate
  // ticks, MIDI play-along notes) DON'T recreate it — recreating it remounted
  // the video, which caused the per-keypress skips, the restart loop, and audio
  // that kept playing after navigating away. Stable only if `onBack` is stable.
  const playerEl = useMemo(() => (
    <PlayerBoundary onBack={onBack}>
      <Suspense fallback={<div className="piano-mode__placeholder">Loading…</div>}>
        {/* focused = the minimal shader (Player suppresses its own overlays; the
            piano chrome provides the controls). */}
        <Player ref={playerRef} play={{ contentId, shader: 'focused' }} clear={onBack} />
      </Suspense>
    </PlayerBoundary>
  ), [contentId, onBack]);

  // Tap the video to toggle browser fullscreen on the video surface.
  const videoWrapRef = useRef(null);
  const toggleFullscreen = useCallback(() => {
    const el = videoWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  }, []);

  // Report active playback to the kiosk context so the inactivity timer stays alive.
  const { setPlaying: setGlobalPlaying, setVideoActive } = usePianoPlayback();
  useEffect(() => {
    setGlobalPlaying(isPlaying);
    return () => setGlobalPlaying(false);
  }, [isPlaying, setGlobalPlaying]);

  // Mark the video player mounted (survives pause, unlike `playing`) so the chrome
  // locks player-switching and the "who's playing?" re-prompt until the lesson is
  // left — a mid-lesson user change would mis-credit the watch.
  useEffect(() => {
    setVideoActive(true);
    return () => setVideoActive(false);
  }, [setVideoActive]);

  const notes = activeNotes || EMPTY_NOTES;

  useEffect(() => {
    getLogger().child({ component: 'piano-video-player' }).info('piano.video.open', { contentId, resumeSeconds });
  }, [contentId, resumeSeconds]);

  // Mirror media-element state into React for the chrome.
  useEffect(() => {
    if (!mediaEl) return undefined;
    const onTime = () => {
      const t = mediaEl.currentTime || 0;
      setCurrentTime(t);
      setFurthestWatched((prev) => (t > prev ? t : prev));
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onMeta = () => {
      setDuration(mediaEl.duration || 0);
      if (mediaEl.videoWidth && mediaEl.videoHeight) setAspect(mediaEl.videoWidth / mediaEl.videoHeight);
    };
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

  // Apply the shared media level to the resolved element (mirrors MusicPlayer).
  useEffect(() => { if (mediaEl) mediaEl.volume = mediaLevel; }, [mediaEl, mediaLevel]);

  const handleRestart = useCallback(() => {
    ctrl.seek(0);
    getLogger().child({ component: 'piano-video-player' }).info('piano.video.restart');
  }, [ctrl]);

  const handleSkip = useCallback((delta) => {
    const cur = ctrl.getCurrentTime() || 0;
    const max = duration > 0 ? duration : cur + Math.abs(delta);
    ctrl.seek(Math.max(0, Math.min(max, cur + delta)));
  }, [ctrl, duration]);

  const handleCycleRate = useCallback(() => {
    const r = nextPianoRate(rate);
    setRate(r);
    playerRef.current?.setPlaybackRate?.(r);
    getLogger().child({ component: 'piano-video-player' }).info('piano.video.rate', { rate: r });
  }, [rate]);

  if (!contentId) {
    return (
      <div className="piano-mode__placeholder">
        This lecture can't be played. <button type="button" onClick={onBack}>Back</button>
      </div>
    );
  }

  if (timedOut && !mediaEl) {
    getLogger().child({ component: 'piano-video-player' }).warn('piano.video.mount-timeout', { contentId });
    return (
      <div className="piano-mode__placeholder">
        This video didn't start. <button type="button" onClick={onBack}>Back to course</button>
      </div>
    );
  }

  return (
    <div className="piano-video-player piano-video-player--playalong">
      {/* Upper row: video + transport (left, sized to the video aspect) and the
          chord-theory column (fills all leftover width to the right). */}
      <div className="piano-video-player__body" ref={bodyRef}>
        <div className="piano-video-player__stack" style={stackW ? { width: `${stackW}px` } : undefined}>
          <div className="piano-video-player__video" ref={videoWrapRef} onClick={ctrl.toggle} style={{ position: 'relative' }}>
            {playerEl}
            {gateOpen && <EngagementGate open={gateOpen} onDismiss={dismissGate} />}
            {!isPlaying && !gateOpen && mediaEl && (
              <PausedLoopOverlay onSkip={handleSkip} onResume={ctrl.toggle} forwardDisabled={false} />
            )}
          </div>

          <PianoVideoChrome
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            rate={rate}
            loop={loop}
            isSequential={isSequential}
            furthestWatched={furthestWatched}
            gateOpen={gateOpen}
            onToggle={ctrl.toggle}
            onRestart={handleRestart}
            onSkip={handleSkip}
            onCycleRate={handleCycleRate}
            onMarkA={loop.markA}
            onMarkB={loop.markB}
            onToggleLoop={loop.toggle}
            onClearLoop={loop.clear}
            onSeek={ctrl.seek}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>

        {/* Right sidebar: circle of fifths (top) · live grand staff (centered) ·
            chord-name badge (bottom). Always visible. */}
        <aside className="piano-video-player__staff">
          <TheoryPanel activeNotes={notes} layout="column" />
        </aside>
      </div>

      {/* Full-width playable keyboard footer — always visible on the main view. */}
      <div className="piano-video-player__keys">
        <PianoKeyboard activeNotes={notes} onNoteOn={pressNote} onNoteOff={releaseNote} />
      </div>
    </div>
  );
}
