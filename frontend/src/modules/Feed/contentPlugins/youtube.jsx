// frontend/src/modules/Feed/contentPlugins/youtube.jsx
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

