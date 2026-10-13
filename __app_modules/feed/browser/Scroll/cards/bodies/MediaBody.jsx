export default function MediaBody({ item }) {
  const subtitle = item.body || null;
  const label = item.meta?.sourceName || item.source || 'Media';
  const isAudio = item.meta?.playable && !item.meta?.youtubeId;
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
        {isAudio && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fab005" style={{ flexShrink: 0 }}>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          </svg>
        )}
        <span style={{
          display: 'inline-block',
          background: '#fab005',
          color: '#000',
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.1rem 0.4rem',
          borderRadius: '4px',
          textTransform: 'uppercase',
        }}>
          {label}
        </span>
        {duration && (
          <span style={{
            fontSize: '0.6rem',
            color: '#868e96',
            marginLeft: 'auto',
          }}>
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
      {subtitle && (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          wordBreak: 'break-word',
        }}>
          {subtitle}
        </p>
      )}
    </>
  );
}
