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

export function useMediaTransportAdapter({ controllerRef, mediaAccess, resilienceBridge }) {
  const warnedMissingMediaRef = useRef(false);

  const getMediaEl = useCallback(() => {
    // Prefer resilience bridge (canonical path)
    if (typeof resilienceBridge?.getMediaEl === 'function') {
      const el = resilienceBridge.getMediaEl();
      if (el) return el;
    }
    // Fallback to legacy mediaAccess
    const accessEl = typeof mediaAccess?.getMediaEl === 'function' ? mediaAccess.getMediaEl() : null;
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
  }, [controllerRef, mediaAccess, resilienceBridge]);

  const getContainerEl = useCallback(() => {
    if (typeof resilienceBridge?.getContainerEl === 'function') {
      return resilienceBridge.getContainerEl();
    }
    return null;
  }, [resilienceBridge]);

  // Deferred capability check — warn only if getMediaEl is still unavailable
  // after the shadow DOM initialization window (2s grace period).
  // The <dash-video> web component needs time to initialize its shadow DOM
  // after mount. Previous mount-time check always fired a false positive.
  const mountTimeRef = useRef(Date.now());
  useEffect(() => {
    if (warnedMissingMediaRef.current) return;
    const timer = setTimeout(() => {
      if (warnedMissingMediaRef.current) return;
      const hasMediaEl =
        typeof resilienceBridge?.getMediaEl === 'function' ||
        typeof mediaAccess?.getMediaEl === 'function' ||
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
  }, [controllerRef, mediaAccess, resilienceBridge]);

  const play = useMemo(() => guard('play', () => controllerRef?.current?.transport?.play?.()), [controllerRef]);
  const pause = useMemo(() => guard('pause', () => controllerRef?.current?.transport?.pause?.()), [controllerRef]);
  const seek = useMemo(() => guard('seek', (seconds) => controllerRef?.current?.transport?.seek?.(seconds)), [controllerRef]);

  return {
    getMediaEl,
    getContainerEl,
    play,
    pause,
    seek
  };
}

export default useMediaTransportAdapter;
