/**
 * Force every <video> inside `containerEl` to be muted, and keep it muted as the
 * DOM changes underneath (e.g. when a `continuous` playlist swaps the source or
 * replaces the <video> element on track advance).
 *
 * The shared <Player> has no `muted` prop and `play={{ volume: 0 }}` is a no-op
 * (useQueueController resolves `play?.volume || ... || 1`, and 0 is falsy), so we
 * mute the underlying element directly. A MutationObserver re-applies the mute to
 * any <video> added or replaced after the initial sweep.
 *
 * @param {HTMLElement|null} containerEl
 * @returns {() => void} cleanup — disconnects the observer.
 */
export function muteVideosIn(containerEl) {
  if (!containerEl || typeof containerEl.querySelectorAll !== 'function') {
    return () => {};
  }

  const muteEl = (videoEl) => {
    if (!videoEl) return;
    // muted is the authoritative gate; volume = 0 is belt-and-suspenders.
    videoEl.muted = true;
    try {
      videoEl.volume = 0;
    } catch {
      // volume can throw in some environments; muted alone is sufficient.
    }
  };

  const sweep = (root) => {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    if (root.tagName === 'VIDEO') muteEl(root);
    root.querySelectorAll('video').forEach(muteEl);
  };

  // Immediate sweep of anything already mounted.
  sweep(containerEl);

  if (typeof MutationObserver !== 'function') {
    return () => {};
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1) sweep(node);
      });
    }
    // Belt-and-suspenders: re-sweep the whole container in case a <video>'s
    // attributes (e.g. an unmute) changed rather than the node being replaced.
    sweep(containerEl);
  });

  observer.observe(containerEl, { childList: true, subtree: true });

  return () => observer.disconnect();
}

export default muteVideosIn;
