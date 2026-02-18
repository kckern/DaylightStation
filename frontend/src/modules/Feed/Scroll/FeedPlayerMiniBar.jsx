import { proxyImage } from './cards/utils.js';
import { feedLog } from './feedLog.js';

function formatTime(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2];

export default function FeedPlayerMiniBar({ item, playback, onOpen, onClose }) {
  if (!item) return null;

  const { playing, currentTime, duration, toggle, seek, speed, setSpeed, progressElRef } = playback || {};

  const cycleSpeed = () => {
    if (!setSpeed) return;
    const idx = SPEED_STEPS.indexOf(speed ?? 1);
    const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
    setSpeed(next);
  };
  // Use image directly if already an API path; otherwise proxy external URLs
  const thumb = item.image
    ? (item.image.startsWith('/api/') ? item.image : proxyImage(item.image))
    : null;

  const handleProgressClick = (e) => {
    if (!duration || !seek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const seekTo = Math.max(0, Math.min(duration, pct * duration));
    feedLog.player('minibar seek', { pct: (pct * 100).toFixed(1) + '%', seekTo: seekTo.toFixed(1), duration: duration.toFixed(1) });
    seek(seekTo);
  };

  return (
    <div className="feed-mini-bar" role="region" aria-label="Now playing">
      {thumb && (
        <img
          src={thumb}
          alt=""
          className="feed-mini-bar-thumb"
          onClick={onOpen}
          onError={(e) => { feedLog.image('minibar thumb failed', { src: thumb }); e.target.style.display = 'none'; }}
        />
      )}
      <div className="feed-mini-bar-info" onClick={onOpen}>
        <span className="feed-mini-bar-source">{item.meta?.sourceName || item.source}</span>
        <span className="feed-mini-bar-title">{item.title}</span>
      </div>
      {duration > 0 && (
        <span className="feed-mini-bar-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      )}
      <button
        className="feed-mini-bar-toggle"
        onClick={(e) => { e.stopPropagation(); toggle?.(); }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          {playing
            ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
            : <path d="M8 5v14l11-7z" />
          }
        </svg>
      </button>
      <button
        className="feed-mini-bar-speed"
        onClick={(e) => { e.stopPropagation(); cycleSpeed(); }}
        aria-label={`Playback speed ${speed ?? 1}x`}
      >
        {speed ?? 1}x
      </button>
      <button
        className="feed-mini-bar-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Stop playback"
      >
        &times;
      </button>
      <div className="feed-mini-bar-progress" onClick={handleProgressClick}>
        <div className="feed-mini-bar-progress-fill" ref={progressElRef} />
      </div>
    </div>
  );
}
