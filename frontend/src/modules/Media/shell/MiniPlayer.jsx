// frontend/src/modules/Media/shell/MiniPlayer.jsx
// The handle on the ambient local session while one exists: a bottom bar with
// a thin live progress strip along its top edge, the current item (tap → Now
// Playing), queue position, play/pause, next, and stop. A stopped session with
// retained queue items keeps a ready handle; an actually empty session renders
// nothing instead of wasting phone space on dead "Idle" chrome.
import React, { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
  IconPlayerSkipForwardFilled,
  IconAlertTriangle,
  IconMoon,
} from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlaybackPosition } from '../controller/usePlaybackPosition.js';
import { useNav } from './NavProvider.jsx';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { useSessionControls, secondsUntil, formatClock } from '../controller/useSessionControls.js';
import { useSecondTick } from './SessionControlsPanel.jsx';
import './NowPlaying.scss';
import './SessionControls.scss';

const PLAYING_STATES = new Set(['playing', 'buffering']);
const NO_PROBLEM = () => null;
const NO_SUBSCRIBE = () => () => {};

// RELY.5a/AC3: the local playback problem, until playback recovers.
function useLocalProblem(controller) {
  const subscribe = useCallback((cb) => controller?.problems?.subscribe?.(cb) ?? NO_SUBSCRIBE(), [controller]);
  const get = useCallback(() => controller?.problems?.get?.() ?? null, [controller]);
  return useSyncExternalStore(controller?.problems ? subscribe : NO_SUBSCRIBE, controller?.problems ? get : NO_PROBLEM, controller?.problems ? get : NO_PROBLEM);
}

function problemLabel(problem) {
  const title = problem.item?.title ?? 'An item';
  if (problem.kind === 'waiting') return `Playback problem: waiting for the file of ${title}`;
  if (problem.kind === 'library-unavailable') return `Playback problem: library unavailable, ${title} is waiting`;
  return problem.kind === 'skipped'
    ? `Playback problem: ${title} was skipped${problem.replacement?.title ? `, now ${problem.replacement.title}` : ''}`
    : `Playback problem: ${title} could not play`;
}

// STEER.10a/AC2: the sleep timer's time left, on the handle.
function SleepTimeLeft() {
  const { controls } = useSessionControls('local');
  const sleepTimer = controls?.sleepTimer ?? null;
  const now = useSecondTick(sleepTimer?.mode === 'minutes');
  if (!sleepTimer) return null;
  if (sleepTimer.mode === 'atEnd') {
    return (
      <span className="mini-player-sleep" data-testid="mini-sleep" aria-label="Sleep timer: stops at the end of this item">
        <IconMoon size={14} aria-hidden /> end
      </span>
    );
  }
  const left = secondsUntil(sleepTimer.endsAt, now) ?? sleepTimer.remainingSeconds;
  return (
    <span className="mini-player-sleep" data-testid="mini-sleep" aria-label={`Sleep timer: ${formatClock(left)} left`}>
      <IconMoon size={14} aria-hidden /> {formatClock(left)}
    </span>
  );
}

export function MiniPlayer() {
  const { controller, snapshot, transport } = useSessionController('local');
  const live = usePlaybackPosition(controller);
  const problem = useLocalProblem(controller);
  const { push, view } = useNav();
  const item = snapshot?.currentItem;
  const queueItems = Array.isArray(snapshot?.queue?.items) ? snapshot.queue.items : [];
  const queueCount = queueItems.length;
  const displayItem = item ?? queueItems[0] ?? null;

  const dockRef = useRef(null);
  // `format` is the canonical signal (set by resultToQueueInput/formatForChild);
  // `mediaType` is a defensive fallback for items that carry only the raw type.
  const isVideo = item?.format === 'video'
    || item?.format === 'dash_video'
    || item?.format === 'hls_video'
    || item?.mediaType === 'video'
    || item?.mediaType === 'dash_video'
    || item?.mediaType === 'hls_video';
  const showVideoDock = !!item && isVideo && view !== 'nowPlaying';
  usePlayerHost(dockRef, 1, showVideoDock);

  if (!displayItem) {
    return null;
  }

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const queuePos = snapshot.queue?.currentIndex ?? -1;
  const repeat = snapshot.config?.repeat ?? 'off';
  const hasNext = queuePos >= 0
    && (queuePos < queueCount - 1 || (repeat === 'all' && queueCount > 1));
  // Now Playing has no nav tab; the mini player IS its affordance, so it
  // lights up while that view is open (see PrimaryNav HIGHLIGHT note).
  const isNowPlayingOpen = view === 'nowPlaying';
  const hasActiveFullLocalControls = isNowPlayingOpen && !!item;

  const duration = item?.duration ?? 0;
  const positionSeconds = live.seconds ?? snapshot.position ?? 0;
  const progressFraction = duration > 0
    ? Math.min(1, Math.max(0, positionSeconds / duration))
    : null;

  // Keep the host hook mounted (host priority/renderer lifetime stay exactly
  // as before), but do not render a second handle over active full controls.
  // A stopped ready queue has no active item and remains reopenable here.
  if (hasActiveFullLocalControls) return null;

  return (
    <div
      data-testid="media-mini-player"
      className={`mini-player ${isNowPlayingOpen ? 'mini-player--active' : ''}${problem ? ' mini-player--problem' : ''}`}
    >
      {problem && (
        <span className="mini-player-problem" data-testid="mini-problem" role="img" aria-label={problemLabel(problem)} title={problemLabel(problem)}>
          <IconAlertTriangle size={18} aria-hidden />
        </span>
      )}
      {progressFraction != null && (
        <div className="mini-player-progress" aria-hidden="true">
          <div
            className="mini-player-progress-fill"
            data-testid="mini-progress"
            style={{ width: `${(progressFraction * 100).toFixed(2)}%` }}
          />
        </div>
      )}
      {showVideoDock ? (
        <button
          type="button"
          data-testid="mini-player-video-dock"
          className="mini-player-video-dock"
          aria-label="Expand video"
          onClick={() => { if (view !== 'nowPlaying') push('nowPlaying', {}); }}
        >
          <div ref={dockRef} className="mini-player-video-dock-host" />
        </button>
      ) : (
        displayItem.thumbnail && (
          <img className="mini-player-thumb" src={displayItem.thumbnail} alt="" loading="lazy" />
        )
      )}
      <button
        type="button"
        data-testid="mini-player-open-nowplaying"
        className="mini-player-title"
        aria-label={item ? `Open now playing, ${item.title ?? item.contentId}` : `Open queue, ${queueCount} item${queueCount === 1 ? '' : 's'} ready`}
        onClick={() => { if (view !== 'nowPlaying') push('nowPlaying', {}); }}
      >
        <span className="mini-player-title-text">
          {item ? (item.title ?? item.contentId) : `${queueCount} item${queueCount === 1 ? '' : 's'} ready`}
        </span>
        {queueCount > 1 && queuePos >= 0 && (
          <span className="mini-queue-count" data-testid="mini-queue-count">
            {queuePos + 1}/{queueCount}
          </span>
        )}
        <SleepTimeLeft />
      </button>
      <div className="mini-player-controls">
        <button
          type="button"
          data-testid="mini-toggle"
          className="np-icon-btn np-icon-btn--primary"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={() => (isPlaying ? transport.pause() : transport.play())}
        >
          {isPlaying ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={20} />}
        </button>
        <button
          type="button"
          data-testid="mini-next"
          className="np-icon-btn"
          aria-label="Next"
          disabled={!hasNext}
          onClick={() => transport.skipNext?.()}
        >
          <IconPlayerSkipForwardFilled size={18} />
        </button>
        <button
          type="button"
          data-testid="mini-stop"
          className="np-icon-btn"
          aria-label="Stop"
          title="Stop playback and keep the queue"
          onClick={() => transport.stop()}
        >
          <IconPlayerStopFilled size={18} />
        </button>
      </div>
    </div>
  );
}

export default MiniPlayer;
