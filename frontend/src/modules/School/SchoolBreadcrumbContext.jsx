import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Breadcrumb bus for the School app, modelled on the Piano Kiosk's
 * (PianoBreadcrumbContext). The always-on School header renders the trail —
 * `[apple home] › section › …deeper` — and deep routes (a material's unit
 * browser, the player) publish their own deeper segments here instead of
 * inventing a second header row with their own back button.
 *
 * Each crumb is `{ label, onClick? }`; an `onClick` makes it a navigable
 * ancestor, the deepest crumb (no handler) renders as the current location.
 */
const BreadcrumbContext = createContext(null);

const EMPTY = { crumbs: [], setCrumbs: () => {} };

export function SchoolBreadcrumbProvider({ children }) {
  const [crumbs, setCrumbs] = useState([]);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/** Read the current extra crumbs + setter. Safe (no-op) outside a provider. */
export function useSchoolBreadcrumbBar() {
  return useContext(BreadcrumbContext) || EMPTY;
}

/**
 * Publish this route's breadcrumb segments (everything past the section crumb
 * the header shows on its own). Clears them on unmount — guarded so a sibling
 * route that mounts first isn't clobbered by this one's teardown.
 *
 * @param {Array<{label:string, onClick?:function}>} crumbs
 */
export function useSchoolBreadcrumb(crumbs) {
  const { setCrumbs } = useSchoolBreadcrumbBar();
  // Re-publish only when the visible labels change (handlers are stable enough
  // for the trail; identity churn on the array itself must not re-fire).
  const key = (crumbs || []).map((c) => c?.label ?? '').join('›');
  useEffect(() => {
    const mine = crumbs || [];
    setCrumbs(mine);
    return () => setCrumbs((cur) => (cur === mine ? [] : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setCrumbs]);
}

export default SchoolBreadcrumbProvider;
