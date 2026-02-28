/**
 * Explicit cleanup for <dash-video> web component on unmount.
 * Firefox has lower SourceBuffer quotas than Chrome; without explicit cleanup,
 * orphaned buffers from rapid remount cycles accumulate to a fixed ceiling.
 */
export function cleanupDashElement(el) {
  if (!el) return;

  // Destroy the dash.js MediaPlayer instance first — this is what owns
  // the MediaSource and SourceBuffers. Without this, orphaned buffers
  // keep polling and throwing InvalidStateError after the element is removed.
  try {
    if (el.api && typeof el.api.destroy === 'function') el.api.destroy();
  } catch (_) {}

  // Try web component's own destroy/reset method as fallback
  try {
    if (typeof el.destroy === 'function') el.destroy();
    else if (typeof el.reset === 'function') el.reset();
  } catch (_) {}

  // Access inner <video> via shadow DOM and clean up
  try {
    const mediaEl = el.shadowRoot?.querySelector('video, audio');
    if (!mediaEl) return;

    mediaEl.pause();

    // Revoke blob URL if present (before clearing src)
    const src = mediaEl.src || '';
    if (src.startsWith('blob:')) {
      try { URL.revokeObjectURL(src); } catch (_) {}
    }

    // W3C-recommended resource release pattern
    mediaEl.removeAttribute('src');
    mediaEl.load();
  } catch (_) {}
}
