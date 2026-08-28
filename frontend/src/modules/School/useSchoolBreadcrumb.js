// useSchoolBreadcrumb.js — breadcrumb-bus hooks for SchoolBreadcrumbContext.jsx,
// split out so Fast Refresh can hot-reload files that only export components.
import { useContext, useEffect } from 'react';
import { BreadcrumbContext } from './SchoolBreadcrumbContext.jsx';

const EMPTY = { crumbs: [], setCrumbs: () => {} };

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
