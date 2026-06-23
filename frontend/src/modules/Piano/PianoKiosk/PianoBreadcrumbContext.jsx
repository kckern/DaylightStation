import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Breadcrumb bus for the piano kiosk. The always-on PianoChrome renders the trail
 * (home › mode › …); deep routes (a course, a lecture, an album, a game) publish
 * their own deeper segments here so the chrome can show them inline — there is no
 * separate back pill or second header row. Each extra crumb is
 * `{ label, onClick? }`; an `onClick` makes it a navigable ancestor, while the
 * deepest crumb (no handler) renders as the current location.
 */
const BreadcrumbContext = createContext(null);

const EMPTY = { crumbs: [], setCrumbs: () => {} };

export function PianoBreadcrumbProvider({ children }) {
  const [crumbs, setCrumbs] = useState([]);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/** Read the current extra crumbs + setter. Safe (no-op) outside a provider. */
export function usePianoBreadcrumbBar() {
  return useContext(BreadcrumbContext) || EMPTY;
}

/**
 * Publish this route's breadcrumb segments (beyond the home/mode crumbs the chrome
 * already shows). Clears them on unmount — guarded so a sibling route that mounts
 * first isn't clobbered by this one's teardown.
 *
 * @param {Array<{label:string, onClick?:function}>} crumbs
 */
export function usePianoBreadcrumb(crumbs) {
  const { setCrumbs } = usePianoBreadcrumbBar();
  // Re-publish only when the visible labels change (handlers are stable callbacks).
  const key = (crumbs || []).map((c) => c?.label ?? '').join('›');
  useEffect(() => {
    const mine = crumbs || [];
    setCrumbs(mine);
    return () => setCrumbs((cur) => (cur === mine ? [] : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setCrumbs]);
}

export default PianoBreadcrumbProvider;
