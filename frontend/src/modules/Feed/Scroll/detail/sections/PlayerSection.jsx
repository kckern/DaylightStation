export default function PlayerSection({ data, onPlay, activeMedia, item, playback }) {
  if (!data?.contentId) return null;

  const isPlaying = activeMedia?.item?.id === item?.id;

  if (!isPlaying) {
    return (
      <button
        onClick={() => onPlay?.(item)}
        style={{
          width: '100%',
          padding: '1rem',
          background: '#1a1b1e',
          border: '1px solid #25262b',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
          <path d="M8 5v14l11-7z" />
        </svg>
        Play
      </button>
    );
  }

  const { playing, currentTime, duration, toggle, seek, progressElRef } = playback || {};

  const formatTime = (s) => {
    if (!s || !Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      background: '#1a1b1e',
      borderRadius: '8px',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          onClick={toggle}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff">
            {playing
              ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
              : <path d="M8 5v14l11-7z" />
            }
          </svg>
        </button>
        <span style={{ fontSize: '0.75rem', color: '#868e96', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <button
          onClick={() => onPlay?.(null)}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: '#868e96',
            cursor: 'pointer',
            padding: '0.25rem',
            fontSize: '0.7rem',
          }}
          aria-label="Stop"
        >
          Stop
        </button>
      </div>
      <div
        style={{
          height: '4px',
          background: '#25262b',
          borderRadius: '2px',
          cursor: 'pointer',
          position: 'relative',
        }}
        onClick={(e) => {
          if (!duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seek?.(pct * duration);
        }}
      >
        <div
          ref={progressElRef}
          style={{
            height: '100%',
            background: '#228be6',
            borderRadius: '2px',
            width: '0%',
          }}
        />
      </div>
    </div>
  );
}
