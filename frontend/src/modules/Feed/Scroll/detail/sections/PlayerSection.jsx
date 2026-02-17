import { lazy, Suspense } from 'react';

const Player = lazy(() => import('../../../../Player/Player.jsx'));

export default function PlayerSection({ data, onPlay, activeMedia, item }) {
  if (!data?.contentId) return null;

  const isPlaying = activeMedia?.item?.id === item?.id;

  if (isPlaying) {
    return (
      <div style={{ borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
        <Suspense fallback={
          <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#868e96' }}>
            Loading player...
          </div>
        }>
          <Player
            play={{ contentId: data.contentId }}
            clear={() => onPlay?.(null)}
            ignoreKeys
            playerType="feed"
          />
        </Suspense>
      </div>
    );
  }

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
