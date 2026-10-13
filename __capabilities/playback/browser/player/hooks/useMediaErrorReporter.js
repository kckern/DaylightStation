import { useEffect, useRef } from 'react';

/**
 * Surfaces media element errors and load-timeouts via onError callback.
 * Re-attaches per mediaKey (a new track → fresh load-timeout window).
 *
 * Inputs:
 *   getMediaEl  () => HTMLMediaElement | null
 *   mediaKey    string|null — identity of the current media (track guid, etc.)
 *   onError     ({ kind, ...details }) => void
 *   mediaLoadTimeoutMs  number|null — if set, fires kind=media-load-timeout when
 *                       neither 'canplay' nor 'playing' arrive within the window
 *   registrationSignal  any — an value whose identity changes whenever a renderer
 *                       registers/deregisters its media element (Player passes its
 *                       `mediaAccess` state). See the note below on why.
 *
 * ELEMENT-AVAILABILITY RE-TRIGGER (2026-07-21):
 * The effect bails when `getMediaEl()` returns null, and at track start it DOES:
 * SinglePlayer renders null until its async meta fetch resolves, so no
 * <video>/<audio> exists yet. Something in the dep list must therefore change
 * again once the element appears, or the 'error' listener and load-timeout timer
 * are never armed for that item.
 *
 * This used to happen by accident: `getMediaEl` carried `[mediaAccess,
 * resilienceBridge]` deps, so every renderer registration minted a new identity
 * and re-ran this effect. The 2026-07-21 leak fix made those callbacks stable for
 * the Player's life (they chained render generations into an unbounded retained
 * list), which silently removed that accidental re-trigger. `registrationSignal`
 * replaces it explicitly — do not remove it, and do not re-couple this to
 * callback identity.
 */
export function useMediaErrorReporter({ getMediaEl, mediaKey, onError, mediaLoadTimeoutMs, registrationSignal }) {
  // Stabilize onError via ref so consumers don't have to wrap in useCallback.
  // Identity churn on onError would otherwise re-run the effect every parent
  // re-render, tearing down listeners and resetting the load-timeout window.
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    if (typeof onErrorRef.current !== 'function') return undefined;
    const el = typeof getMediaEl === 'function' ? getMediaEl() : null;
    if (!el) return undefined;

    let timer = null;
    let resolved = false;
    const clearLoadTimer = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      el.removeEventListener('canplay', resolveLoad);
      el.removeEventListener('playing', resolveLoad);
    };
    function resolveLoad() {
      resolved = true;
      clearLoadTimer();
    }

    const handleError = () => {
      onErrorRef.current?.({
        kind: 'media-error',
        code: el.error?.code ?? null,
        message: el.error?.message ?? 'media element error',
        networkState: el.networkState,
        readyState: el.readyState,
        src: el.currentSrc || null,
        mediaKey: mediaKey || null,
      });
      // Cancel any pending load-timeout — the consumer just got the real error,
      // a redundant media-load-timeout would be noise for the same dead load.
      resolved = true;
      clearLoadTimer();
    };
    el.addEventListener('error', handleError);

    if (mediaLoadTimeoutMs && mediaLoadTimeoutMs > 0) {
      // Already playable (HAVE_FUTURE_DATA or better) — canplay/playing won't
      // re-fire, so arming the timer would spuriously emit media-load-timeout.
      if (el.readyState >= 3) { resolved = true; return () => {
        el.removeEventListener('error', handleError);
      }; }
      el.addEventListener('canplay', resolveLoad);
      el.addEventListener('playing', resolveLoad);
      timer = setTimeout(() => {
        if (resolved) return;
        onErrorRef.current?.({
          kind: 'media-load-timeout',
          timeoutMs: mediaLoadTimeoutMs,
          networkState: el.networkState,
          readyState: el.readyState,
          src: el.currentSrc || null,
          mediaKey: mediaKey || null,
        });
        clearLoadTimer();
      }, mediaLoadTimeoutMs);
    }

    return () => {
      el.removeEventListener('error', handleError);
      clearLoadTimer();
    };
    // registrationSignal: re-run when a renderer registers its element (see note above).
  }, [getMediaEl, mediaKey, mediaLoadTimeoutMs, registrationSignal]);
}
