import { createContext, useMemo, useState } from 'react';

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
export const BreadcrumbContext = createContext(null);

export function SchoolBreadcrumbProvider({ children }) {
  const [crumbs, setCrumbs] = useState([]);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export default SchoolBreadcrumbProvider;
