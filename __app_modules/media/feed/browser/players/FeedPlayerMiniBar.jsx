import { useRef } from 'react';
import { proxyImage, safeImage } from "../Scroll/cards/utils.js";
import { feedLog } from "../Scroll/feedLog.js";
import { useFeedPlayer } from "./FeedPlayerContext.jsx";
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { formatFeedPlaybackTime } from './formatTime.js';
import { getSeekMax } from './seekRange.js';
import "./FeedPlayerMiniBar.scss";

export default function FeedPlayerMiniBar({ item, playback, onOpen, onClose, openerRef }) {
  // All hooks must run before any early return (rules-of-hooks).
  const { speed, cycleSpeed, pausedMedia, resumePaused } = useFeedPlayer();
  const touchRef = useRef({ startY: 0 });

  if (!item) return null;

  const { playing, currentTime, duration, toggle, seek, progressElRef } = playback || {};
  const seekMax = getSeekMax(duration);
  const resumeLabel = pausedMedia?.item?.title ? `Resume: ${pausedMedia.item.title}` : 'Resume previous';

  // Use image directly if already an API path; otherwise proxy external URLs
  // The app's own image endpoints load directly; external images go through the proxy.
  const thumb = proxyImage(item.image) || safeImage(item.image);
  const handleBarTouchStart = (e) => { touchRef.current.startY = e.touches[0].clientY; };
  const handleBarTouchEnd = (e) => {
    const dy = e.changedTouches[0].clientY - touchRef.current.startY;
    if (dy < -60) {
      feedLog.player('minibar swipe-up');
      onOpen?.();
    }
  };

  const handleProgressChange = (event) => {
    if (!seekMax || !seek) return;
    const seekTo = Number(event.target.value);
    const pct = seekTo / seekMax;
    feedLog.player('minibar seek', { pct: (pct * 100).toFixed(1) + '%', seekTo: seekTo.toFixed(1), duration: seekMax.toFixed(1) });
    seek(seekTo);
  };

  return (
    <div
      className="feed-mini-bar"
      role="region"
      aria-label="Now playing"
      onTouchStart={handleBarTouchStart}
      onTouchEnd={handleBarTouchEnd}
    >
      <button ref={openerRef} type="button" className="feed-mini-bar-open ds-touch-target" onClick={onOpen} aria-label={`Open player: ${item.title}`}>
        {thumb && (
          <img
            src={thumb}
            alt=""
            className="feed-mini-bar-thumb"
            onError={(e) => { feedLog.image('minibar thumb failed', { src: thumb }); e.target.style.display = 'none'; }}
          />
        )}
        <span className="feed-mini-bar-info">
          <span className="feed-mini-bar-source">{item.meta?.sourceName || item.source}</span>
          <span className="feed-mini-bar-title">{item.title}</span>
        </span>
      </button>
      {duration > 0 && (
        <span className="feed-mini-bar-time">
          {formatFeedPlaybackTime(currentTime)} / {formatFeedPlaybackTime(duration)}
        </span>
      )}
      <button
        className="feed-mini-bar-toggle ds-touch-target"
        onClick={(e) => { e.stopPropagation(); toggle?.(); }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <UiIcon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <button
        className="feed-mini-bar-speed ds-touch-target"
        onClick={(e) => { e.stopPropagation(); cycleSpeed(); }}
        aria-label={`Playback speed ${speed ?? 1}x`}
      >
        {speed ?? 1}x
      </button>
      <button
        className="feed-mini-bar-close ds-touch-target"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Stop playback"
      >
        &times;
      </button>
      {pausedMedia && (
        <button
          className="feed-mini-bar-resume-paused ds-touch-target"
          onClick={(e) => { e.stopPropagation(); resumePaused(); }}
          aria-label={resumeLabel}
          title={resumeLabel}
        >
          ↩ Prev
        </button>
      )}
      <div className="feed-mini-bar-progress">
        <div className="feed-mini-bar-progress-fill" ref={progressElRef} />
        <input className="feed-mini-bar-progress-input" type="range" min="0" max={seekMax} step="1" value={Math.min(currentTime || 0, seekMax)} disabled={seekMax === 0} onChange={handleProgressChange} aria-label="Playback position"
          aria-valuetext={`${formatFeedPlaybackTime(currentTime)} of ${formatFeedPlaybackTime(duration)}`} />
      </div>
    </div>
  );
}
