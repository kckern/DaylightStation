import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Breadcrumb bus for the piano kiosk. The always-on PianoChrome renders the trail
 * (home › mode › …); deep routes (a course, a lecture, an album, a game) publish
 * their own deeper segments here so the chrome can show them inline — there is no
 * separate back pill or second header row. Each extra crumb is
 * `{ label, onClick?, icon?, image? }`; `onClick` makes it a navigable/actionable
 * crumb even when it's the last one (e.g. sheet music's mode crumb opens
 * ModeSheet), `icon` renders the shared Icon, and `image` renders a small thumb
 * (e.g. a score's splash image). A crumb with no handler renders as inert current
 * location.
 */
const BreadcrumbContext = createContext(null);

const EMPTY = { crumbs: [], setCrumbs: () => {} };

export function PianoBreadcrumbProvider({ children }) {
  const [crumbs, setCrumbs] = useState([]);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/** Read the current extra crumbs + setter. Safe (no-op) outside a provider. */
// eslint-disable-next-line react-refresh/only-export-components -- usePianoBreadcrumbBar is co-located with its Context/Provider (standard pattern); 6 consumers, splitting out of scope for a lint pass
export function usePianoBreadcrumbBar() {
  return useContext(BreadcrumbContext) || EMPTY;
}

/**
 * Publish this route's breadcrumb segments (beyond the home/mode crumbs the chrome
 * already shows). Clears them on unmount — guarded so a sibling route that mounts
 * first isn't clobbered by this one's teardown.
 *
 * @param {Array<{label:string, onClick?:function, icon?:string, image?:string}>} crumbs
 */
// eslint-disable-next-line react-refresh/only-export-components -- usePianoBreadcrumb is co-located with its Context/Provider (standard pattern); 24 consumers, splitting out of scope for a lint pass
export function usePianoBreadcrumb(crumbs) {
  const { setCrumbs } = usePianoBreadcrumbBar();
  // Re-publish when the visible labels, icons, or images change (handlers are
  // stable callbacks). Folding image/icon into the key matters because a splash
  // image can land after the label already mounted the crumb (its fetch races
  // the score XML fetch) — without it in the key, that late arrival never
  // triggers a re-publish and the thumbnail is stuck missing until something
  // else (e.g. a mode change) forces a re-render.
  const key = (crumbs || []).map((c) => `${c?.label ?? ''}|${c?.image ?? ''}|${c?.icon ?? ''}`).join('›');
  useEffect(() => {
    const mine = crumbs || [];
    setCrumbs(mine);
    return () => setCrumbs((cur) => (cur === mine ? [] : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setCrumbs]);
}

export default PianoBreadcrumbProvider;
