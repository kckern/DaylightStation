import { useEffect, useRef, useCallback, useMemo } from 'react';
import { getChildLogger } from '../lib/logging/singleton.js';

/**
 * Captures a snapshot of all viewport-related metrics.
 */
function getViewportSnapshot() {
  const vv = window.visualViewport;
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    outerW: window.outerWidth,
    outerH: window.outerHeight,
    dpr: window.devicePixelRatio,
    screenW: window.screen?.width,
    screenH: window.screen?.height,
    vvScale: vv?.scale ?? null,
    vvWidth: vv?.width ?? null,
    vvHeight: vv?.height ?? null,
    vvOffsetLeft: vv?.offsetLeft ?? null,
    vvOffsetTop: vv?.offsetTop ?? null,
  };
}

/**
 * Returns true if any metric changed between two snapshots.
 */
function snapshotChanged(a, b) {
  if (!a || !b) return true;
  return Object.keys(a).some((k) => a[k] !== b[k]);
}

/**
 * Hook that logs viewport metrics at mount and on every change.
 * Designed to diagnose Fully Kiosk Browser zoom shifts on NVIDIA Shield.
 *
 * @param {React.RefObject} containerRef - ref to .tv-app element for bounding rect
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true] - toggle logging on/off
 */
export function useViewportProbe(containerRef, { enabled = true } = {}) {
  const logger = useMemo(() => getChildLogger({ component: 'viewport-probe' }), []);
  const prevRef = useRef(null);
  const mountTs = useRef(Date.now());

  const capture = useCallback(
    (trigger) => {
      if (!enabled) return;

      const snap = getViewportSnapshot();
      const changed = snapshotChanged(prevRef.current, snap);

      // Only log if something actually changed (or first capture)
      if (!changed && trigger !== 'mount') return;

      const rect = containerRef?.current?.getBoundingClientRect();
      const containerRect = rect
        ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
        : null;

      const delta = prevRef.current
        ? {
            dInnerW: snap.innerW - prevRef.current.innerW,
            dInnerH: snap.innerH - prevRef.current.innerH,
            dDpr: +(snap.dpr - prevRef.current.dpr).toFixed(4),
            dVvScale: snap.vvScale != null && prevRef.current.vvScale != null
              ? +(snap.vvScale - prevRef.current.vvScale).toFixed(4)
              : null,
          }
        : null;

      logger.info(`viewport-${trigger}`, {
        ms: Date.now() - mountTs.current,
        ...snap,
        containerRect,
        delta,
      });

      prevRef.current = snap;
    },
    [enabled, containerRef, logger],
  );

  useEffect(() => {
    if (!enabled) return;

    // Capture at mount
    capture('mount');

    // Capture shortly after mount to catch deferred zoom
    const t1 = setTimeout(() => capture('post-mount-100'), 100);
    const t2 = setTimeout(() => capture('post-mount-500'), 500);
    const t3 = setTimeout(() => capture('post-mount-2000'), 2000);

    // Listen to resize and visualViewport changes
    const onResize = () => capture('resize');
    const onVvResize = () => capture('vv-resize');
    const onVvScroll = () => capture('vv-scroll');

    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onVvResize);
    window.visualViewport?.addEventListener('scroll', onVvScroll);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onVvResize);
      window.visualViewport?.removeEventListener('scroll', onVvScroll);
    };
  }, [enabled, capture]);
}
