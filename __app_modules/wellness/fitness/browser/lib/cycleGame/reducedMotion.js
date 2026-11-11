// prefers-reduced-motion for JS-driven motion (the CSS side is the
// cg-reduced-motion mixin in widgets/CycleGame/_cgTokens.scss). Pure read, no
// subscription: callers ask once per frame / per tick, so a mid-race change of
// the OS setting is honoured on the next frame.
export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {
    return false;
  }
}

export default prefersReducedMotion;
