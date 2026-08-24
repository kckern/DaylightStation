import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { resolveProfile, GUEST_PROFILE } from './pianoUser.js';

/**
 * Piano roster + current player.
 *
 * The piano kiosk has a roster (household.yml → users). Whoever is sitting
 * down picks themselves; their recordings, lesson progress, and preferences are
 * all scoped to that user on the backend. The selection persists per piano (so a
 * given kiosk remembers who used it last) and defaults to the first on the roster.
 */
const PianoUserContext = createContext(null);

export function PianoUserProvider({ pianoId, children }) {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrent] = useState(null);
  const storeKey = `piano:user:${pianoId || 'default'}`;

  // Load the roster, retrying transient failures: kiosks reload exactly when
  // the backend restarts (deploys), and a single failed fetch used to leave
  // the tab userless until a manual reload (audit F6). Bounded backoff, then
  // give up (the tab is likely offline for good).
  const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let attempt = 0;
    const load = () => {
      DaylightAPI('api/v1/piano/users')
        .then((r) => { if (!cancelled) setUsers(Array.isArray(r?.users) ? r.users : []); })
        .catch(() => {
          if (cancelled || attempt >= RETRY_DELAYS_MS.length) return;
          const delay = RETRY_DELAYS_MS[attempt];
          attempt += 1;
          getLogger().child({ component: 'piano-user' }).warn('piano.user.roster-retry', { attempt, delay });
          timer = setTimeout(load, delay);
        });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once fetch loop
  }, []);

  // Restore the last player for this piano once the roster loads. A persisted
  // 'guest' is a deliberate "stepping away" state (screen-off / dismissed
  // prompt) and must survive reloads — falling back to users[0] here would
  // silently credit the first roster user (audit F3).
  useEffect(() => {
    if (!users.length) return;
    let saved = null;
    let requested = null;
    try { saved = localStorage.getItem(storeKey); } catch { /* private mode */ }
    try { requested = new URLSearchParams(window.location.search).get('user'); } catch { /* no location */ }
    const known = (id) => id === GUEST_PROFILE.id || users.some((u) => u.id === id);
    setCurrent((prev) => {
      if (requested && known(requested)) return requested;
      if (prev && known(prev)) return prev;
      if (saved && known(saved)) return saved;
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
