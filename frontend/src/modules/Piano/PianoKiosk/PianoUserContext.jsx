import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { resolveProfile } from './pianoUser.js';

/**
 * Piano roster + current player.
 *
 * The piano kiosk has a roster (piano.yml → users.primary). Whoever is sitting
 * down picks themselves; their recordings, lesson progress, and preferences are
 * all scoped to that user on the backend. The selection persists per piano (so a
 * given kiosk remembers who used it last) and defaults to the first on the roster.
 */
const PianoUserContext = createContext(null);

export function PianoUserProvider({ pianoId, children }) {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrent] = useState(null);
  const storeKey = `piano:user:${pianoId || 'default'}`;

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/piano/users')
      .then((r) => { if (!cancelled) setUsers(Array.isArray(r?.users) ? r.users : []); })
      .catch(() => { if (!cancelled) setUsers([]); });
    return () => { cancelled = true; };
  }, []);

  // Restore the last player for this piano once the roster loads.
  useEffect(() => {
    if (!users.length) return;
    let saved = null;
    try { saved = localStorage.getItem(storeKey); } catch { /* private mode */ }
    setCurrent((prev) => {
      if (prev && users.some((u) => u.id === prev)) return prev;
      if (saved && users.some((u) => u.id === saved)) return saved;
      return users[0].id;
    });
  }, [users, storeKey]);

  const setCurrentUser = useCallback((id) => {
    setCurrent(id);
    try { localStorage.setItem(storeKey, id); } catch { /* private mode */ }
    getLogger().child({ component: 'piano-user' }).info('piano.user.select', { id });
  }, [storeKey]);

  const currentProfile = useMemo(
    () => resolveProfile(users, currentUser),
    [users, currentUser],
  );

  const value = useMemo(
    () => ({ users, currentUser, currentProfile, setCurrentUser }),
    [users, currentUser, currentProfile, setCurrentUser],
  );
  return <PianoUserContext.Provider value={value}>{children}</PianoUserContext.Provider>;
}

export function usePianoUser() {
  const ctx = useContext(PianoUserContext);
  if (!ctx) throw new Error('usePianoUser must be used within a PianoUserProvider');
  return ctx;
}

export default PianoUserContext;
