import { useContext } from 'react';
import SessionSourceContext from './SessionSourceContext.jsx';

/**
 * Hook: read the injected SessionSource. Returns null when no provider
 * supplied a source.
 */
export function useSessionSourceContext() {
  return useContext(SessionSourceContext).source;
}
