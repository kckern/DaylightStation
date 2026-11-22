import { createContext, useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { daylightApiResponse } from '../../lib/api.mjs';
import { useRefreshableRead } from '../../lib/hooks/useRefreshableRead.js';

export const PublicAuthContext = createContext(null);

/** Own the public context read used by both app startup and the sign-in form. */
export function SetupCheck({ children }) {
  const { pathname } = useLocation();
  const bypass = pathname === '/setup' || pathname.startsWith('/invite/');
  const [released, setReleased] = useState(false);
  const [result, setResult] = useState(null);

  const settle = useCallback(outcome => {
    setResult({ ...outcome, pathname });
    setReleased(true);
  }, [pathname]);
  const onTimeout = useCallback(() => {
    settle({ error: new Error('The household setup check timed out.') });
  }, [settle]);
  const read = useCallback(async (isCurrent, signal) => {
    setResult(null);
    if (bypass) {
      setReleased(true);
      return;
    }

    try {
      // This public read uses same-origin cookies before a login mode is known.
      const response = await daylightApiResponse('/api/v1/auth/context', { signal });
      if (!response.ok) throw new Error('The public context request failed.');
      const { needsSetup, setupAdmin, householdName } = await response.json();
      if (typeof needsSetup !== 'boolean' || (setupAdmin != null && typeof setupAdmin !== 'string')) {
        throw new Error('The public context has an invalid setup state.');
      }
      if (isCurrent()) settle({ data: {
        needsSetup,
        setupAdmin,
        householdName: typeof householdName === 'string' ? householdName : null,
      } });
    } catch {
      if (isCurrent()) settle({ error: new Error('The household setup could not be checked.') });
    }
  }, [bypass, settle]);

  const { reload } = useRefreshableRead(read, { timeoutMs: 5000, onTimeout });
  useEffect(() => { void reload(); }, [reload]);

  const current = result?.pathname === pathname ? result : null;
  const data = current?.data ?? null;
  if (!released && !bypass) return null;
  if (!bypass && data?.needsSetup && !data.setupAdmin) return <Navigate to="/setup" replace />;

  return <PublicAuthContext.Provider value={{ data, error: current?.error, pending: !bypass && !current, reload }}>
    {children}
  </PublicAuthContext.Provider>;
}
