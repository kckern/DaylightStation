// frontend/src/modules/Media/shell/MiniPlayer.jsx
// The always-visible handle on the ambient local session: a bottom bar with
// a thin live progress strip along its top edge, the current item (tap → Now
// Playing), queue position, play/pause, next, and stop. Renders a slim "Idle"
// bar when no session — never disappears entirely, so the session always has
// a visible anchor.
import React, { useRef } from 'react';
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
  IconPlayerSkipForwardFilled,
} from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlaybackPosition } from '../controller/usePlaybackPosition.js';
import { useNav } from './NavProvider.jsx';
import { usePlayerHost } from '../session/usePlayerHost.js';
import './NowPlaying.scss';

const PLAYING_STATES = new Set(['playing', 'buffering']);

export function MiniPlayer() {
  const { controller, snapshot, transport } = useSessionController('local');
  const live = usePlaybackPosition(controller);
  const { push, view } = useNav();
  const item = snapshot?.currentItem;

  const dockRef = useRef(null);
  // `format` is the canonical signal (set by resultToQueueInput/formatForChild);
  // `mediaType` is a defensive fallback for items that carry only the raw type.
  const isVideo = item?.format === 'video' || item?.mediaType === 'video';
  const showVideoDock = isVideo && view !== 'nowPlaying';
  usePlayerHost(dockRef, 1, showVideoDock);

  if (!item) {
    return (
      <div data-testid="media-mini-player" className="mini-player mini-player--idle">
        <span className="np-state">Idle</span>
      </div>
    );
  }

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const queueCount = snapshot.queue?.items?.length ?? 0;
  const queuePos = snapshot.queue?.currentIndex ?? -1;
  const repeat = snapshot.config?.repeat ?? 'off';
  const hasNext = queuePos >= 0
    && (queuePos < queueCount - 1 || (repeat === 'all' && queueCount > 1));
  // Now Playing has no nav tab; the mini player IS its affordance, so it
  // lights up while that view is open (see PrimaryNav HIGHLIGHT note).
  const isNowPlayingOpen = view === 'nowPlaying';

  const duration = item.duration ?? 0;
  const positionSeconds = live.seconds ?? snapshot.position ?? 0;
  const progressFraction = duration > 0
    ? Math.min(1, Math.max(0, positionSeconds / duration))
    : null;

  return (
    <div
      data-testid="media-mini-player"
      className={`mini-player ${isNowPlayingOpen ? 'mini-player--active' : ''}`}
    >
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
        item.thumbnail && (
          <img className="mini-player-thumb" src={item.thumbnail} alt="" loading="lazy" />
        )
      )}
      <button
        type="button"
        data-testid="mini-player-open-nowplaying"
        className="mini-player-title"
        onClick={() => { if (view !== 'nowPlaying') push('nowPlaying', {}); }}
      >
        <span className="mini-player-title-text">{item.title ?? item.contentId}</span>
        {queueCount > 1 && queuePos >= 0 && (
          <span className="mini-queue-count" data-testid="mini-queue-count">
            {queuePos + 1}/{queueCount}
          </span>
        )}
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
          title="Stop and clear current item"
          onClick={() => transport.stop()}
        >
          <IconPlayerStopFilled size={18} />
        </button>
      </div>
    </div>
  );
}

export default MiniPlayer;
