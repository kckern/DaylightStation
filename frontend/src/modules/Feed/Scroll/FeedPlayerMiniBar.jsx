export default function FeedPlayerMiniBar({ item, onOpen, onClose }) {
  if (!item) return null;

  return (
    <div className="feed-mini-bar" onClick={onOpen}>
      <div className="feed-mini-bar-info">
        <span className="feed-mini-bar-source">{item.meta?.sourceName || item.source}</span>
        <span className="feed-mini-bar-title">{item.title}</span>
      </div>
      <button
        className="feed-mini-bar-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Stop playback"
      >
        &times;
      </button>
    </div>
  );
}
