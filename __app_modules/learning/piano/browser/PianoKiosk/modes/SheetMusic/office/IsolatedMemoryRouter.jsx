import { MemoryRouter, UNSAFE_LocationContext, UNSAFE_RouteContext } from 'react-router-dom';

const NO_ROUTE = { outlet: null, matches: [], isDataRoute: false };

/**
 * A MemoryRouter that may sit inside another router.
 *
 * Learn keeps its state (passage, lab) in the URL. On the office screen the
 * player already lives under the screen's own router, and React Router refuses
 * a router inside a router ("You cannot render a <Router> inside another
 * <Router>"). Clearing the outer location and route contexts gives the inner
 * router a clean root, so Learn's URL changes stay in memory and never touch
 * the screen's URL.
 */
export default function IsolatedMemoryRouter({ children, ...props }) {
  return (
    <UNSAFE_LocationContext.Provider value={null}>
      <UNSAFE_RouteContext.Provider value={NO_ROUTE}>
        <MemoryRouter {...props}>{children}</MemoryRouter>
      </UNSAFE_RouteContext.Provider>
    </UNSAFE_LocationContext.Provider>
  );
}
