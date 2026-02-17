import { lazy, Suspense, forwardRef } from 'react';

const Player = lazy(() => import('../../Player/Player.jsx'));

const PersistentPlayer = forwardRef(function PersistentPlayer({ contentId, onEnd }, ref) {
  if (!contentId) return null;

  return (
    <div
      style={{
        position: 'fixed',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <Suspense fallback={null}>
        <Player
          ref={ref}
          play={{ contentId }}
          clear={onEnd}
          ignoreKeys
          playerType="feed"
        />
      </Suspense>
    </div>
  );
});

export default PersistentPlayer;
