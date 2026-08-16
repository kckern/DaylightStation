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

  // Resolve the element that actually holds the media. For <dash-video> that is
  // the inner element in the shadow root; for the NATIVE branch the container IS
  // the <video>, and it has no shadow root at all. Both branches render under the
  // same containerRef and the same dashElementKey, so this cleanup runs for both
  // — resolving only through shadowRoot bailed here and left a replaced native
  // element playing on with no DOM node and no controls bound to it.
  try {
    const mediaEl = el.shadowRoot?.querySelector('video, audio')
      || (typeof el.pause === 'function' ? el : null);
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
