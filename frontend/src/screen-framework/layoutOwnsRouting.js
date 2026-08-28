// layoutOwnsRouting.js — routing-owner widget detection for ScreenRenderer.jsx,
// split out so Fast Refresh can hot-reload the renderer on its own.

/**
 * EXCEPTION — routing-owning widgets. A screen whose layout is a full-screen
 * app that owns its own URL (the Portal's `school` widget) keeps the path
 * suffix for the app to parse into its own deep-link state; the menu autoplay
 * must NOT swallow it or clean it away. Query-based autoplay (?queue=…, for
 * casting content OVER the app) still runs — only the path branch is skipped.
 */
const ROUTING_OWNER_WIDGETS = new Set(['school']);

export function layoutOwnsRouting(layout) {
  const scan = (node) => {
    if (!node) return false;
    if (Array.isArray(node)) return node.some(scan);
    if (typeof node !== 'object') return false;
    if (typeof node.widget === 'string' && ROUTING_OWNER_WIDGETS.has(node.widget)) return true;
    return Object.values(node).some(scan);
  };
  return scan(layout);
}
