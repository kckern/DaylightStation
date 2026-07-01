/**
 * Keep-alive driver — the fix for the SM-T590 WebView frame-clock stall.
 *
 * On this device the Chromium WebView starves BeginFrame/vsync: unless *something*
 * on the page continuously presents compositor frames, rAF AND every CSS/JS
 * animation throttle to ~6fps while CPU/GPU sit idle — the whole UI (waterfall,
 * cover-flow, menus, games) janks. It is global frame starvation, not a per-
 * component paint cost. The cure is one element animating on the compositor every
 * vsync.
 *
 * The driver is a pure CSS `transform` animation on a tiny always-animating layer
 * (`.piano-vsync-driver`): it composites on the GPU, presents a frame every vsync,
 * can't be culled, and needs no user activation — it lifts the whole page
 * 6fps → ~28fps immediately.
 *
 * (An earlier muted <video> secondary driver was removed: the WebView culled it,
 * it needed a user-gesture to autoplay, and it threw "no supported sources"
 * error spam. The CSS animation alone is sufficient.)
 */
export default function KeepAliveVideo() {
  return <div className="piano-vsync-driver" aria-hidden="true" />;
}
