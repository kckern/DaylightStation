import { useCallback, useEffect, useMemo, useRef } from 'react';
import { playbackLog } from '../../lib/playbackLogger.js';

const guard = (label, fn) => (...args) => {
  try {
    return fn(...args);
  } catch (error) {
    playbackLog('transport-guard-error', { action: label, message: error?.message || 'transport-error' }, { level: 'warn' });
    return null;
  }
};

/**
 * Media transport adapter with STABLE callback identities.
 *
 * LEAK REGRESSION GUARD (2026-07-21 fitness kiosk, 14 GB heap): the previous
 * implementation took `resilienceBridge` (a value read from a ref during
 * render) and `mediaAccess` as useCallback deps. Every bridge/mediaAccess
 * re-registration minted a new `getMediaEl` closure that captured the
 * PREVIOUS generation's bridge object, chaining all render generations into
 * one unbounded retained list — and the identity churn fed a setState
 * feedback loop (renderer registration effect <-> Player.setMediaAccess <->
 * useMediaResilience/requestRecovery <-> SinglePlayer bridge memo) running at
 * thousands of renders per second.
 *
 * The adapter now receives `resilienceBridgeRef` (the ref itself) and mirrors
 * `mediaAccess` into a ref, so every callback keeps ONE identity for the
 * life of the Player while always resolving the CURRENT objects at call time.
 */
export function useMediaTransportAdapter({ controllerRef, mediaAccess, resilienceBridgeRef }) {
  const warnedMissingMediaRef = useRef(false);

  // Live mirror — read at call time, never captured as a dep.
  const mediaAccessRef = useRef(mediaAccess);
  mediaAccessRef.current = mediaAccess;

  const getMediaEl = useCallback(() => {
    // Prefer resilience bridge (canonical path)
    const bridge = resilienceBridgeRef?.current;
    if (typeof bridge?.getMediaEl === 'function') {
      const el = bridge.getMediaEl();
      if (el) return el;
    }
    // Fallback to legacy mediaAccess
    const access = mediaAccessRef.current;
    const accessEl = typeof access?.getMediaEl === 'function' ? access.getMediaEl() : null;
    if (accessEl) return accessEl;
    // Final fallback to controllerRef transport
    const transportEl = controllerRef?.current?.transport?.getMediaEl;
    if (typeof transportEl === 'function') {
      try {
        return transportEl();
      } catch (error) {
        playbackLog('transport-getMediaEl-error', { message: error?.message || 'transport-error' }, { level: 'warn' });
        return null;
      }
    }
    return null;
  }, [controllerRef, resilienceBridgeRef]);

  const getContainerEl = useCallback(() => {
    const bridge = resilienceBridgeRef?.current;
    if (typeof bridge?.getContainerEl === 'function') {
      return bridge.getContainerEl();
    }
    return null;
  }, [resilienceBridgeRef]);

  // Deferred capability check — warn only if getMediaEl is still unavailable
  // after the shadow DOM initialization window (2s grace period).
  // The <dash-video> web component needs time to initialize its shadow DOM
  // after mount. Reads the live refs at fire time; armed once per mount.
  const mountTimeRef = useRef(Date.now());
  useEffect(() => {
    if (warnedMissingMediaRef.current) return undefined;
    const timer = setTimeout(() => {
      if (warnedMissingMediaRef.current) return;
      const hasMediaEl =
        typeof resilienceBridgeRef?.current?.getMediaEl === 'function' ||
        typeof mediaAccessRef.current?.getMediaEl === 'function' ||
        typeof controllerRef?.current?.transport?.getMediaEl === 'function';
      if (!hasMediaEl) {
        warnedMissingMediaRef.current = true;
        playbackLog('transport-capability-missing', {
          capability: 'getMediaEl',
          delayMs: Date.now() - mountTimeRef.current
        }, { level: 'warn' });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [controllerRef, resilienceBridgeRef]);

  const play = useMemo(() => guard('play', () => controllerRef?.current?.transport?.play?.()), [controllerRef]);
  const pause = useMemo(() => guard('pause', () => controllerRef?.current?.transport?.pause?.()), [controllerRef]);
  const seek = useMemo(() => guard('seek', (seconds) => controllerRef?.current?.transport?.seek?.(seconds)), [controllerRef]);

  return useMemo(() => ({
    getMediaEl,
    getContainerEl,
    play,
    pause,
    seek
  }), [getMediaEl, getContainerEl, play, pause, seek]);
}

export default useMediaTransportAdapter;
