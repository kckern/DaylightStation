import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { LoadingState } from '../../../lib/ui/index.js';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';

// The Media Player is heavy: load it with the review page only.
const Player = lazy(() => import('../../../../../__app_modules/media/media/browser/playback.mjs'));

/**
 * Review is for timing, not viewing (owner, 2026-11-23: "quality isn't a consideration"): the film
 * is requested small so seeks and jumps land fast. Plex transcodes down to these caps (see
 * __docs/reference/player/playback-quality.md). Raise `maxResolution` (480, 720) if a picture
 * effect needs a closer look; `null` for each removes the cap.
 */
export const REVIEW_QUALITY = Object.freeze({ maxResolution: 360, maxVideoBitrate: 1000 });

/**
 * The film in the Media Player with the filter forced on, whatever its certification, so a
 * grown-up sees each effect as the household will. Driven only through previewStore
 * (jumpToCue, peek, currentTime). No resume and no progress logging: a review must not move
 * anyone's place.
 */
export function ReviewPlayer({ ratingKey, unfiltered = false }) {
  // Before the Player's first render: its filter hook reads the force while it decides.
  useState(() => { previewStore.forceFilter(ratingKey); return null; });
  useEffect(() => {
    previewStore.forceFilter(ratingKey);
    return () => { previewStore.forceFilter(null); previewStore.clearPending(); };
  }, [ratingKey]);
  const play = useMemo(() => ({ contentId: `plex:${ratingKey}`, resume: false }), [ratingKey]);
  return (
    <div className="cf-review__player" data-unfiltered={unfiltered || undefined}>
      {unfiltered ? <span className="cf-review__unfiltered" role="status">Unfiltered</span> : null}
      <Suspense fallback={<LoadingState label="player" rows={1} />}>
        {/* The auxiliary preview leaves viewing progress and queue commands alone.
            Review owns shortcuts and native controls keep their activation keys. */}
        <Player play={play} clear={() => {}} playerType="preview" auxiliary ignoreKeys
          maxResolution={REVIEW_QUALITY.maxResolution} maxVideoBitrate={REVIEW_QUALITY.maxVideoBitrate} />
      </Suspense>
    </div>
  );
}

export default ReviewPlayer;
