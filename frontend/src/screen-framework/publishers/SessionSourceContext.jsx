import React, { createContext, useContext, useMemo } from 'react';

/**
 * SessionSourceContext — lets a descendant component register a
 * SessionSource (see `./SessionSource.js`) for the surrounding screen.
 *
 * Because the real player + queue live inside an overlay (Player.jsx) and
 * aren't reachable from ScreenRenderer, the overlay can publish its
 * current source through this context so the renderer-level publishers
 * can observe it. When no source is provided, consumers should fall back
 * to an idle SessionSource.
 *
 * The context stores a plain `{ source }` object so a ref-style register
 * isn't strictly necessary — for v1 we use a simple static provider.
 * Future work (§2.3 of the plan) will swap this for a register/deregister
 * API once players can opt in dynamically.
 */
const SessionSourceContext = createContext({ source: null });

/**
 * Provide a session source to descendants.
 */
export function SessionSourceProvider({ source, children }) {
  const value = useMemo(() => ({ source: source ?? null }), [source]);
  return (
    <SessionSourceContext.Provider value={value}>
      {children}
    </SessionSourceContext.Provider>
  );
}

/**
 * Hook: read the injected SessionSource. Returns null when no provider
 * supplied a source.
 */
export function useSessionSourceContext() {
  return useContext(SessionSourceContext).source;
}

export default SessionSourceContext;
