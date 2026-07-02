import { useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
// 3KB near-black H.264 loop WITH a silent AAC track. Both details are load-
// bearing on this device:
//  - `?inline` ships it INSIDE the bundle as a data: URI — no HTTP fetch. The
//    backend hangs on GET /*.mp4 (media-route interceptor), so a public/ asset
//    would reproduce the old "no supported sources" failure.
//  - The silent audio track exempts it from Chromium's power intervention that
//    pauses VIDEO-ONLY media ("video-only background media was paused to save
//    power" — observed live 2026-07-01). Muted playback keeps autoplay legal.
import keepAliveSrc from './vsyncKeepalive.mp4?inline';

/**
 * Keep-alive driver — the fix for the SM-T590 WebView frame-clock stall.
 *
 * On this device the Chromium WebView starves BeginFrame/vsync: unless *something*
 * on the page continuously presents compositor frames, rAF AND every CSS/JS
 * animation throttle to ~6-10fps while CPU/GPU sit idle — the whole UI janks.
 * It is global frame starvation, not a per-component paint cost.
 *
 * REGRESSION HISTORY (2026-07-01): a "CSS-only is sufficient" cleanup removed the
 * muted <video> driver (7de308f70). Within 32 minutes of that build going live the
 * watchdog telemetry began logging sustained ~8-10fps episodes: pages loaded at
 * ~60fps and DECAYED to a hard ~100ms/frame floor as they aged — the CSS driver's
 * near-invisible animation (opacity 0.012) evidently gets classified as
 * imperceptible and unscheduled by the current WebView (Chrome 149). So this is
 * belt-and-suspenders BY DESIGN — do not remove either driver without watching
 * piano.watchdog telemetry on an AGED page (>30 min), not just a fresh load:
 *
 *  1. A muted looping <video> (media path presents a frame per vsync). The old
 *     video failed for fixable reasons: broken source ("no supported sources"
 *     spam), 6px size (culled), and a gesture gate FKB doesn't need — the tablet
 *     runs FKB with autoplayVideos=true, so muted autoplay starts unaided. The
 *     asset is a 2KB near-black H.264 loop (public/vsync-keepalive.mp4) sized
 *     48px and parked in the dark header band, where opaque dark content is
 *     invisible to the eye but undeniable to the compositor.
 *  2. The CSS transform driver (`.piano-vsync-driver`, PianoApp.scss) — also
 *     hardened to be compositor-perceptible (opaque near-background color, not
 *     ghost opacity).
 *
 * Telemetry: emits keepalive.playing / keepalive.play-blocked / keepalive.stalled
 * so prod logs show whether the media path is actually live on-device.
 */
export default function KeepAliveVideo() {
  const ref = useRef(null);
  const canvasRef = useRef(null);

  // Driver 3 (2026-07-01, the main-thread one): field data showed the compositor
  // drivers above are NOT sufficient on Chrome 149 — the user saw the CSS pill
  // animating smoothly while rAF/React sat at ~7fps, because compositor-thread
  // animation is decoupled from MAIN-thread BeginFrame scheduling, which is what
  // Chromium throttles when it deems the page idle. Crucially, BLE-MIDI input is
  // NOT user activity to Chromium (only touch/keys are), so a piano kiosk is
  // "idle" even mid-performance and key highlights lag by whole frames.
  // Counter: repaint a tiny canvas at 30Hz from a setInterval — NOT rAF (rAF is
  // the throttled victim; a timer isn't) — generating genuine main-thread paint
  // damage every tick so the page never classifies as idle. Alternating fills
  // defeat any identical-frame optimization. Validated via the always-on
  // perf.diagnostics telemetry (PianoApp) — check aged-page fps in prod logs
  // before touching any of the three drivers.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) return undefined;
    let flip = false;
    const id = setInterval(() => {
      flip = !flip;
      ctx.fillStyle = flip ? '#17171c' : '#18181d'; // near-identical darks — invisible, but real damage
      ctx.fillRect(0, 0, c.width, c.height);
    }, 33);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    const logger = getLogger().child({ component: 'piano-keepalive' });

    v.muted = true; // property AND attribute — both matter for autoplay policy
    let everPlayed = false;
    const play = () => v.play().then(() => {
      if (!everPlayed) { everPlayed = true; logger.info('keepalive.playing', {}); }
    }).catch((err) => {
      logger.warn('keepalive.play-blocked', { error: err?.message });
    });

    play();
    // Resilience: retry on any gesture, and periodically in case the WebView
    // paused the element (backgrounding, screen-off, media-session churn).
    const onGesture = () => { if (v.paused) play(); };
    const opts = { capture: true, passive: true };
    document.addEventListener('pointerdown', onGesture, opts);
    document.addEventListener('keydown', onGesture, opts);
    const retry = setInterval(() => {
      if (v.paused) { logger.sampled('keepalive.stalled', {}, { maxPerMinute: 2 }); play(); }
    }, 30000);

    return () => {
      clearInterval(retry);
      document.removeEventListener('pointerdown', onGesture, opts);
      document.removeEventListener('keydown', onGesture, opts);
    };
  }, []);

  return (
    <>
      {/* Driver 1: media-path vsync. Dark 48px video, opaque, in the dark header
          band — invisible on the chrome, but real decoded frames every vsync. */}
      <video
        ref={ref}
        className="piano-keepalive-video"
        src={keepAliveSrc}
        muted
        loop
        autoPlay
        playsInline
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* Driver 2: compositor CSS animation (see .piano-vsync-driver). */}
      <div className="piano-vsync-driver" aria-hidden="true" />
      {/* Driver 3: main-thread paint damage @30Hz (see effect above). Must be
          on-screen and unoccluded or its damage can be culled with it. */}
      <canvas
        ref={canvasRef}
        className="piano-keepalive-canvas"
        width={24}
        height={24}
        aria-hidden="true"
      />
    </>
  );
}
