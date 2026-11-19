import { lazy, Suspense, forwardRef, useCallback, useMemo, useRef } from 'react';
import { feedLog } from "./feedLog.js";

const Player = lazy(() => import("../../../media/browser/playback.mjs"));

const PersistentPlayer = forwardRef(function PersistentPlayer({ media, onEnd, speed, volume }, ref) {
  const contentId = media?.contentId;
  // Memoize the play prop so Player receives a stable object reference.
  // Without this, every parent re-render creates a new { contentId } object,
  // which Player's WeakMap-based ensureEntryGuid treats as "new media",
  // causing a full SinglePlayer remount that destroys the audio element.
  const play = useMemo(() => {
    feedLog.player(contentId ? 'PersistentPlayer mount' : 'PersistentPlayer unmount', { contentId });
    return contentId ? { contentId } : null;
  }, [contentId]);
  const resumed = useRef(null);

  // The lazy Player can attach after Feed selects a speed, and can replace
  // its session handle when a different track or collection takes ownership.
  const attachPlayer = useCallback(handle => {
    if (typeof ref === 'function') ref(handle);
    else if (ref) ref.current = handle;
    if (handle && Number.isFinite(media?.position) && resumed.current !== media) {
      const result = handle.beginRendererBoundary({
        expectedContentId: contentId,
        targetSeconds: media.position,
        autoplay: true,
        requireObserver: false,
        source: 'feed-resume',
      });
      if (result.ok) resumed.current = media;
    }
    if (handle && handle.getPlaybackRate() !== speed) handle.setPlaybackRate(speed);
  }, [ref, speed, media, contentId]);

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
          ref={attachPlayer}
          play={play}
          volume={volume}
          clear={onEnd}
          ignoreKeys
          playerType="feed"
        />
      </Suspense>
    </div>
  );
});

export default PersistentPlayer;
