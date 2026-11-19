// Share browser viewport events. The caller decides how the visible bounds
// affect its surface and owns any additional scroll or focus listeners.
export function observeVisualViewport(update) {
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  update();
  return () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
  };
}
