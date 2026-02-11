// frontend/src/lib/playable/usePlayableLifecycle.js

/**
 * Hook for non-media playable content types.
 *
 * Handles the three Playable Contract lifecycle signals that non-media
 * renderers (apps, future slideshow/pageturner) need:
 *   1. Startup signal on mount
 *   2. Resolved metadata reporting when meta changes
 *   3. Media access registration (defaults to no media element)
 *
 * Note: Callbacks fire once on mount (startup, media access) or on meta change.
 * They should be stable references to avoid unexpected behavior if deps are
 * later expanded.
 *
 * Media renderers (VideoPlayer, AudioPlayer) use useCommonMediaController instead.
 * Scroller renderers (Singalong, Readalong) use useMediaReporter instead.
 *
 * @param {Object} options
 * @param {Function} [options.onStartupSignal] - Called once on mount
 * @param {Function} [options.onResolvedMeta] - Called when meta changes (pass memoized meta)
 * @param {Function} [options.onRegisterMediaAccess] - Called once on mount with accessors
 * @param {Object|null} [options.meta] - Metadata to report (memoize to avoid re-fires)
 * @param {Object|null} [options.mediaAccess] - Media accessors (default: null element)
 */
import { useEffect } from 'react';

const NO_MEDIA_ACCESS = { getMediaEl: () => null, hardReset: null };

export function usePlayableLifecycle({
  onStartupSignal,
  onResolvedMeta,
  onRegisterMediaAccess,
  meta = null,
  mediaAccess = null
} = {}) {
  // Signal startup on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onStartupSignal?.();
  }, []);

  // Report resolved metadata when meta changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (meta) {
      onResolvedMeta?.(meta);
    }
  }, [meta]);

  // Register media access on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onRegisterMediaAccess?.(mediaAccess || NO_MEDIA_ACCESS);
  }, []);
}
