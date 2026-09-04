//
// Layout facts that BOTH the stylesheet and the JavaScript need, declared once.
//
// The desktop sidebar is not only a CSS arrangement: the widgets that live in
// it are 30-day surfaces, and mounting them on a phone would fire a range
// request for something nobody can see. So the breakpoint has to exist in JS
// as well as in SCSS — and two hand-copied numbers that must agree is exactly
// the kind of pair that silently drifts. `health.scss` declares
// `$health-aside-breakpoint` with the same value and a pointer back here;
// layout.contract.test.js reads the COMPILED stylesheet and fails if they ever
// disagree (jsdom cannot see layout, but it can read a compiled rule).
import { useEffect, useState } from 'react';

/** Below this the Today column is a single stack; at or above it, main + aside. */
export const ASIDE_MIN_WIDTH_PX = 1100;
export const ASIDE_MEDIA_QUERY = `(min-width: ${ASIDE_MIN_WIDTH_PX}px)`;

/**
 * True while the viewport is wide enough for the sidebar to exist.
 *
 * Returns false wherever `matchMedia` does not (jsdom, SSR) — the safe answer,
 * because false means "do not mount the desktop-only widgets", i.e. do not
 * fetch data for a column nobody is looking at.
 */
export function useIsWideViewport() {
  const [wide, setWide] = useState(() => window.matchMedia?.(ASIDE_MEDIA_QUERY)?.matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia?.(ASIDE_MEDIA_QUERY);
    if (!mql) return undefined;
    const onChange = (e) => setWide(e.matches);
    setWide(mql.matches);
    // addEventListener is the modern API; addListener is the Safari<14 fallback
    // this household's kiosks are old enough to still need.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);
  return wide;
}
