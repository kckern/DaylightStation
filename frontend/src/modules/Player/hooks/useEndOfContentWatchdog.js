/**
 * useEndOfContentWatchdog
 *
 * Wires `createEndOfContentWatchdog` into a React component's media element.
 * The hook owns the watchdog instance, subscribes to the player events that
 * could change monitored state (timeupdate / pause / play / seeked), resets
 * the watchdog when the media source changes, and cleans up on unmount.
 *
 * Once armed, the watchdog drives its own setTimeout — no React-level polling.
 *
 * Usage in ContentScroller:
 *
 *     useEndOfContentWatchdog({ mediaRef: mainRef, sourceKey: mainMediaUrl, onAdvance });
 *
 * See: docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md
 *      frontend/src/modules/Player/lib/endOfContentWatchdog.js
 */
import { useEffect, useRef } from 'react';
import { createEndOfContentWatchdog } from '../lib/endOfContentWatchdog.js';
import { getLogger } from '../../../lib/logging/Logger.js';

export function useEndOfContentWatchdog({
  mediaRef,
  getMediaEl,            // dash-video hides the real <video> in a shadow root
  sourceKey,             // pass mainMediaUrl (or any value that changes per asset)
  onAdvance,
  thresholdSeconds,
  idleMs,
  enabled = true
}) {
  const watchdogRef = useRef(null);
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;

  // dash-video hides the real <video> in a shadow root, so callers pass
  // getMediaEl(); plain <video> callers pass a ref. Exactly one is required.
  // Kept behind a ref so getMediaEl's per-render identity change never re-runs
  // the effect (it must NOT go in the dependency array).
  const getMediaElRef = useRef(null);
  getMediaElRef.current = typeof getMediaEl === 'function'
    ? getMediaEl
    : () => mediaRef?.current ?? null;

  // Lazy-create the watchdog on first effect run so its closures see the
  // current refs. Tear down and rebuild when sourceKey changes so the
  // one-shot guard is fresh per asset.
  useEffect(() => {
    if (!enabled) return undefined;
    const el = getMediaElRef.current();
    if (!el) return undefined;

    const logger = (() => {
      try { return getLogger().child({ component: 'ContentScroller', watchdog: 'end-of-content' }); }
      catch (_) { return null; }
    })();

    watchdogRef.current = createEndOfContentWatchdog({
      onAdvance: () => onAdvanceRef.current?.(),
      getMediaInfo: () => {
        const node = getMediaElRef.current();
        if (!node) return null;
        return {
          currentTime: node.currentTime,
          duration: node.duration,
          paused: node.paused,
          seeking: node.seeking
        };
      },
      thresholdSeconds,
      idleMs,
      log: (event, data) => { try { logger?.warn(event, data); } catch (_) { /* swallow */ } }
    });

    const tick = () => watchdogRef.current?.tick();
    el.addEventListener('timeupdate', tick);
    el.addEventListener('pause', tick);
    el.addEventListener('play', tick);
    el.addEventListener('seeked', tick);

    return () => {
      el.removeEventListener('timeupdate', tick);
      el.removeEventListener('pause', tick);
      el.removeEventListener('play', tick);
      el.removeEventListener('seeked', tick);
      watchdogRef.current?.reset();
      watchdogRef.current = null;
    };
  }, [mediaRef, sourceKey, enabled, thresholdSeconds, idleMs]);
}
