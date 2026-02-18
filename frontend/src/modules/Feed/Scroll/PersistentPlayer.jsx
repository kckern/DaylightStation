import { lazy, Suspense, forwardRef, useMemo } from 'react';
import { feedLog } from './feedLog.js';

const Player = lazy(() => import('../../Player/Player.jsx'));

const PersistentPlayer = forwardRef(function PersistentPlayer({ contentId, onEnd }, ref) {
  // Memoize the play prop so Player receives a stable object reference.
  // Without this, every parent re-render creates a new { contentId } object,
  // which Player's WeakMap-based ensureEntryGuid treats as "new media",
  // causing a full SinglePlayer remount that destroys the audio element.
  const play = useMemo(() => {
    feedLog.player(contentId ? 'PersistentPlayer mount' : 'PersistentPlayer unmount', { contentId });
    return contentId ? { contentId } : null;
  }, [contentId]);

  if (!play) return null;

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
          play={play}
          clear={onEnd}
          ignoreKeys
          playerType="feed"
        />
      </Suspense>
    </div>
  );
});

export default PersistentPlayer;
