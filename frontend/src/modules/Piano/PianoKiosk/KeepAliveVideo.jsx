import { useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * Keep-alive video — the fix for the SM-T590 WebView frame-clock stall.
 *
 * On this device the Chromium WebView's BeginFrame/vsync delivery intermittently
 * starves, throttling rAF AND compositor animations to ~7-10fps while GPU/CPU sit
 * idle (a near-empty screen stalls too). A *playing* <video> forces the compositor
 * to present a new frame every vsync via the media path, which breaks the
 * starvation loop and keeps the whole page rendering at full speed.
 *
 * Measured (2026-06-23): keep-alive OFF → 7fps, GPU 0%; keep-alive ON → no jank,
 * GPU ~57% (real frames). See docs/_wip/bugs/2026-06-23-piano-kiosk-jank-paint-bound.md.
 *
 * The element must be technically visible (not display:none / opacity:0) to be
 * composited. It's 6px, ~invisible, bottom-right, non-interactive. The asset is a
 * tiny 64x64 60fps muted loop (frontend/public/keepalive.mp4).
 */
export default function KeepAliveVideo() {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    const logger = getLogger().child({ component: 'piano-keepalive' });
    v.muted = true;
    const play = () => v.play().catch((e) => logger.warn('keepalive.play-rejected', { err: e?.name }));
    play();
    // Re-assert if the WebView ever pauses it (tab backgrounding, focus loss).
    const onPause = () => { logger.warn('keepalive.paused-replay', {}); play(); };
    v.addEventListener('pause', onPause);
    logger.info('keepalive.mounted', {});
    return () => v.removeEventListener('pause', onPause);
  }, []);
  return (
    <video
      ref={ref}
      src="/keepalive.mp4"
      autoPlay
      loop
      muted
      playsInline
      aria-hidden="true"
      style={{ position: 'fixed', bottom: 0, right: 0, width: 6, height: 6, opacity: 0.02, pointerEvents: 'none', zIndex: 0 }}
    />
  );
}
