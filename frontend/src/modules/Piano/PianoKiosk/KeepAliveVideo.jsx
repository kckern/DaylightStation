import { useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * Keep-alive driver — the fix for the SM-T590 WebView frame-clock stall.
 *
 * On this device the Chromium WebView's BeginFrame/vsync delivery starves:
 * unless *something* on the page is continuously presenting compositor frames,
 * rAF AND every CSS/JS animation throttle to ~6fps while CPU/GPU sit idle. A
 * near-empty screen stalls too. The whole page — waterfall, cover-flow, menus,
 * games — janks, regardless of how cheap the animation is. It is NOT a paint or
 * layout cost in any one component; it is global frame starvation.
 *
 * The cure is to keep one element animating on the compositor every vsync.
 *
 * Earlier this was a tiny muted <video> (the media path presents a frame per
 * vsync). Measured on-device (2026-06): that video is unreliable — at 6px /
 * opacity 0.02 the WebView culls/throttles it so it does NOT drive vsync, and it
 * needs a user gesture to start (muted-autoplay gate). With the video "playing"
 * the waterfall still sat at 6fps. Dropping in ANY live CSS transform animation
 * instead lifted the whole page 6fps → ~28fps immediately, no gesture needed.
 *
 * So the primary driver is now a CSS `transform` animation on a tiny element
 * (`.piano-vsync-driver`): it composites on the GPU, presents a frame every
 * vsync, can't be culled the way the video was, and needs no user activation.
 * The muted <video> is kept as a secondary belt-and-suspenders driver.
 */
export default function KeepAliveVideo() {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    const logger = getLogger().child({ component: 'piano-keepalive' });
    v.muted = true;
    const play = () => v.play().catch(() => {});
    play();
    const onGesture = () => play();
    const opts = { capture: true, passive: true };
    document.addEventListener('pointerdown', onGesture, opts);
    document.addEventListener('keydown', onGesture, opts);
    document.addEventListener('touchstart', onGesture, opts);
    logger.info('keepalive.mounted', {});
    return () => {
      document.removeEventListener('pointerdown', onGesture, opts);
      document.removeEventListener('keydown', onGesture, opts);
      document.removeEventListener('touchstart', onGesture, opts);
    };
  }, []);
  return (
    <>
      {/* Primary vsync driver: a tiny always-animating compositor layer. This is
          what actually keeps the WebView presenting frames. */}
      <div className="piano-vsync-driver" aria-hidden="true" />
      {/* Secondary driver: muted looping video (media-path vsync). Unreliable on
          its own — kept as backup only. */}
      <video
        ref={ref}
        src="/keepalive.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        style={{ position: 'fixed', bottom: 0, right: 0, width: 6, height: 6, opacity: 0.02, pointerEvents: 'none', zIndex: 2147483646 }}
      />
    </>
  );
}
