import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { LoadingState } from '../../../../../../frontend/src/lib/ui/index.js';
import { previewStore } from '../../content-filter/preview/previewStore.js';

// The Media Player is heavy: load it with the review page only.
const Player = lazy(() => import('../../playback.mjs'));

/**
 * The film in the Media Player with the filter forced on, whatever its certification, so a
 * grown-up sees each effect as the household will. Driven only through previewStore
 * (jumpToCue, peek, currentTime). No resume and no progress logging: a review must not move
 * anyone's place.
 */
export function ReviewPlayer({ ratingKey }) {
  // Before the Player's first render: its filter hook reads the force while it decides.
  useState(() => { previewStore.forceFilter(ratingKey); return null; });
  useEffect(() => {
    previewStore.forceFilter(ratingKey);
    return () => previewStore.forceFilter(null);
  }, [ratingKey]);
  const play = useMemo(() => ({ contentId: `plex:${ratingKey}`, resume: false }), [ratingKey]);
  return (
    <div className="cf-review__player">
      <Suspense fallback={<LoadingState label="player" rows={1} />}>
        {/* auxiliary: no watch-progress logging (a parent reviewing must not move the family's
            place or mark the film watched) and no screen-level queue commands. */}
        <Player play={play} clear={() => {}} playerType="preview" auxiliary />
      </Suspense>
    </div>
  );
}

export default ReviewPlayer;
