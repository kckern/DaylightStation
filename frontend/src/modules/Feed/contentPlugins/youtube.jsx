// frontend/src/modules/Feed/contentPlugins/youtube.jsx
import { useState } from 'react';

// =========================================================================
// Scroll Body (masonry card)
// =========================================================================

export function YouTubeScrollBody({ item }) {
  const channelName = item.meta?.channelName || item.meta?.sourceName || 'YouTube';
  const duration = item.meta?.duration;

  const formatDuration = (seconds) => {
    if (!seconds || !Number.isFinite(seconds)) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#ff0000" style={{ flexShrink: 0 }}>
          <path d="M21.8 8s-.2-1.4-.8-2c-.7-.8-1.6-.8-2-.8C15.6 5 12 5 12 5s-3.6 0-7 .2c-.4 0-1.3 0-2 .8-.6.6-.8 2-.8 2S2 9.6 2 11.2v1.5c0 1.6.2 3.2.2 3.2s.2 1.4.8 2c.7.8 1.7.8 2.2.8 1.5.2 6.8.2 6.8.2s3.6 0 7-.2c.4-.1 1.3-.1 2-.9.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5c0-1.6-.2-3.1-.2-3.1zM9.9 15.1V8.9l5.4 3.1-5.4 3.1z" />
        </svg>
        <span style={{
          display: 'inline-block',
          background: '#ff0000',
          color: '#fff',
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.1rem 0.4rem',
          borderRadius: '4px',
          textTransform: 'uppercase',
        }}>
          {channelName}
        </span>
        {duration && (
          <span style={{ fontSize: '0.6rem', color: '#868e96', marginLeft: 'auto' }}>
            {formatDuration(duration)}
          </span>
        )}
      </div>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 500,
        color: '#fff',
        wordBreak: 'break-word',
      }}>
        {item.title}
      </h3>
      {item.body && (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {item.body}
        </p>
      )}
    </>
  );
}

// =========================================================================
// Reader Row (inbox)
// =========================================================================

export function YouTubeReaderRow({ article, onMarkRead }) {
  const [expanded, setExpanded] = useState(false);
  const videoId = article.meta?.videoId;
  const thumbnailUrl = article.image || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);
  const channelName = article.meta?.channelName || article.feedTitle || 'YouTube';

  const handleExpand = () => {
    if (!expanded) {
      setExpanded(true);
      if (!article.isRead) onMarkRead?.(article.id);
    } else {
      setExpanded(false);
    }
  };

  const formatTime = (published) => {
    if (!published) return '';
    const d = new Date(published);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + time;
  };

  return (
    <div className={`article-row ${expanded ? 'expanded' : ''} ${article.isRead ? 'read' : 'unread'}`}>
      {!expanded ? (
        <button className="article-row-header youtube-row-header" onClick={handleExpand}>
          {thumbnailUrl && (
            <div className="youtube-thumb-wrapper">
              <img src={thumbnailUrl} alt="" className="youtube-thumb" />
              <span className="youtube-play-badge">&#9654;</span>
            </div>
          )}
          <div className="youtube-row-text">
            <span className="article-title">{article.title}</span>
            <span className="youtube-channel-name">{channelName}</span>
          </div>
          <span className="article-time">{formatTime(article.published)}</span>
        </button>
      ) : (
        <div>
          <button className="article-row-header" onClick={handleExpand}>
            <span className="article-title">{article.title}</span>
            <span className="article-time">{formatTime(article.published)}</span>
          </button>
          <div className="article-expanded">
            {videoId && (
              <div className="youtube-embed-wrapper">
                <iframe
                  src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
                  title={article.title}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="youtube-embed"
                />
              </div>
            )}
            <div className="article-meta">
              <span>{channelName}</span>
              {article.author && <span> &middot; {article.author}</span>}
              {article.published && <span> &middot; {new Date(article.published).toLocaleString()}</span>}
            </div>
            {article.link && (
              <a
                className="article-source-link"
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                Open on YouTube &rarr;
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
