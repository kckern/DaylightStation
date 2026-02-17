import { proxyImage } from './cards/utils.js';

export default function FeedPlayerMiniBar({ item, playback, onOpen, onClose }) {
  if (!item) return null;

  const { playing, toggle, progressElRef } = playback || {};
  const thumb = item.image ? proxyImage(item.image) : null;

  return (
    <div className="feed-mini-bar" role="region" aria-label="Now playing">
      {thumb && (
        <img
          src={thumb}
          alt=""
          className="feed-mini-bar-thumb"
          onClick={onOpen}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}
      <div className="feed-mini-bar-info" onClick={onOpen}>
        <span className="feed-mini-bar-source">{item.meta?.sourceName || item.source}</span>
        <span className="feed-mini-bar-title">{item.title}</span>
      </div>
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
        className="feed-mini-bar-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Stop playback"
      >
        &times;
      </button>
      <div className="feed-mini-bar-progress">
        <div className="feed-mini-bar-progress-fill" ref={progressElRef} />
      </div>
    </div>
  );
}
