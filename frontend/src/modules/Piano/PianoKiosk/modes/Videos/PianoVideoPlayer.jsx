// PianoVideoPlayer.jsx
import { useRef, useState, useEffect, useCallback, Suspense, lazy } from 'react';
import usePlayerController from '../../../../Player/usePlayerController.js';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import PlayerBoundary from './PlayerBoundary.jsx';
import PianoVideoChrome from './PianoVideoChrome.jsx';
import useResolvedMediaEl from './useResolvedMediaEl.js';
import useABLoop from './useABLoop.js';
import usePianoWatchLog from './usePianoWatchLog.js';
import { nextPianoRate } from './pianoPlaybackRate.js';
import { lectureContentId, deriveResumeSeconds } from './lectureMeta.js';

// Player is heavy — code-split it so the menu/other modes don't pay for it.
const Player = lazy(() => import('../../../../Player/Player.jsx'));

const EMPTY_NOTES = new Map();

/** Custom student video player for a single piano lecture, with MIDI play-along. */
export default function PianoVideoPlayer({ lecture, onBack }) {
  const playerRef = useRef(null);
  const ctrl = usePlayerController(playerRef);
  const mediaEl = useResolvedMediaEl(playerRef);
  const { activeNotes, pressNote, releaseNote } = usePianoMidi();
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [playAlong, setPlayAlong] = useState(true);

  const contentId = lectureContentId(lecture);
  const title = lecture?.label || lecture?.title || '';
  const resumeSeconds = deriveResumeSeconds(lecture);
  const loop = useABLoop(mediaEl, ctrl.seek, ctrl.getCurrentTime);
  usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds });

  // Report active playback to the kiosk context so the inactivity timer stays alive.
  const { setPlaying: setGlobalPlaying } = usePianoPlayback();
  useEffect(() => {
    setGlobalPlaying(isPlaying);
    return () => setGlobalPlaying(false);
  }, [isPlaying, setGlobalPlaying]);

  const notes = activeNotes || EMPTY_NOTES;

  useEffect(() => {
    getLogger().child({ component: 'piano-video-player' }).info('piano.video.open', { contentId, resumeSeconds });
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

  const togglePlayAlong = useCallback(() => {
    setPlayAlong((v) => {
      const next = !v;
      getLogger().child({ component: 'piano-video-player' }).info('piano.video.playalong', { on: next });
      return next;
    });
  }, []);

  if (!contentId) {
    return (
      <div className="piano-mode__placeholder">
        This lecture can’t be played. <button type="button" onClick={onBack}>Back</button>
      </div>
    );
  }

  return (
    <div className={`piano-video-player${playAlong ? ' piano-video-player--playalong' : ''}`}>
      <div className="piano-video-player__video">
        <PlayerBoundary onBack={onBack}>
          <Suspense fallback={<div className="piano-mode__placeholder">Loading…</div>}>
            <Player ref={playerRef} play={{ contentId }} clear={onBack} />
          </Suspense>
        </PlayerBoundary>
      </div>

      <PianoVideoChrome
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        rate={rate}
        loop={loop}
        playAlong={playAlong}
        onToggle={ctrl.toggle}
        onSkip={handleSkip}
        onCycleRate={handleCycleRate}
        onMarkA={loop.markA}
        onMarkB={loop.markB}
        onClearLoop={loop.clear}
        onSeek={ctrl.seek}
        onBack={onBack}
        onTogglePlayAlong={togglePlayAlong}
      />

      {playAlong && (
        <div className="piano-video-player__keys">
          <PianoKeyboard activeNotes={notes} onNoteOn={pressNote} onNoteOff={releaseNote} />
        </div>
      )}
    </div>
  );
}
