/**
 * useBumper — whether the "Edited for content" bumper is showing. It shows once
 * per mount, on the first `playing` at or near the start (not on a resume), for
 * holdMs, over playback (the video is not paused). Spec §2:
 * ops:docs/superpowers/specs/2026-11-06-content-filter-surround-design.md
 *
 * getMediaEl is read through a latest-value ref, like useContentFilter, so the
 * caller need not keep its identity stable. The element is re-resolved after
 * every commit until the first play decides, so a media element that appears
 * (or is replaced) after mount is still the one listened to.
 */
import { useEffect, useRef, useState } from 'react';
import { getChildLogger } from "../../../../../frontend/src/lib/logging/singleton.js";

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter' }));

export const BUMPER_START_WINDOW_SEC = 5;

export function useBumper({ getMediaEl, enabled, holdMs = 4000, startWindowSec = BUMPER_START_WINDOW_SEC }) {
  const [shown, setShown] = useState(false);
  const doneRef = useRef(false);
  const timerRef = useRef(null);
  const getMediaElRef = useRef(getMediaEl);
  getMediaElRef.current = getMediaEl;
  const optsRef = useRef({ holdMs, startWindowSec });
  optsRef.current = { holdMs, startWindowSec };
  const boundRef = useRef({ el: null, off: null });

  useEffect(() => () => {
    boundRef.current.off?.();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // After every commit: listen on the current element until the first play decides.
  useEffect(() => {
    const el = (enabled && !doneRef.current) ? (getMediaElRef.current?.() || null) : null;
    if (el === boundRef.current.el) return;
    boundRef.current.off?.();
    boundRef.current = { el: null, off: null };
    if (!el) return;

    const check = () => {
      if (doneRef.current) return;
      doneRef.current = true; // the first play decides, whether or not it shows
      boundRef.current.off?.();
      boundRef.current = { el: null, off: null };
      const t = el.currentTime;
      const { holdMs: hold, startWindowSec: windowSec } = optsRef.current;
      if (!(Number.isFinite(t) && t <= windowSec)) {
        logger().debug?.('content-filter.bumper.skipped', { at: Number.isFinite(t) ? +t.toFixed(2) : null, reason: 'resume' });
        return;
      }
      setShown(true);
      logger().info?.('content-filter.bumper.shown', { at: +t.toFixed(2), holdMs: hold });
      timerRef.current = setTimeout(() => { timerRef.current = null; setShown(false); }, hold);
    };

    if (el.paused === false) { check(); return; }
    el.addEventListener('playing', check);
    boundRef.current = { el, off: () => el.removeEventListener('playing', check) };
  });

  return shown;
}
