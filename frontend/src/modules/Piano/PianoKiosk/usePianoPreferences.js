import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoUser } from './PianoUserContext.jsx';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-preferences' });
  return _logger;
}

/**
 * Per-user piano preferences (opaque blob behind /users/:userId/preferences).
 * GET on user change; setPref() PUTs a shallow-merge patch (server merges).
 *
 * @returns {{ prefs: object, loaded: boolean, getPref: (k,d)=>any, setPref: (k,v)=>Promise<void> }}
 */
export function usePianoPreferences() {
  const { currentUser } = usePianoUser();
  const [prefs, setPrefs] = useState({});
  const [loaded, setLoaded] = useState(false);
  const userRef = useRef(currentUser);
  userRef.current = currentUser;

  useEffect(() => {
    if (!currentUser) { setPrefs({}); setLoaded(false); return undefined; }
    let cancelled = false;
    setLoaded(false);
    DaylightAPI(`api/v1/piano/users/${currentUser}/preferences`)
      .then((r) => {
        if (!cancelled) {
          setPrefs(r && typeof r === 'object' ? r : {});
          setLoaded(true);
          logger().debug('preferences.load', { user: currentUser });
        }
      })
      .catch((e) => {
        if (!cancelled) { setPrefs({}); setLoaded(true); }
        logger().warn('preferences.load.fail', { user: currentUser, error: e?.message });
      });
    return () => { cancelled = true; };
  }, [currentUser]);

  const getPref = useCallback(
    (key, fallback) => (key in prefs ? prefs[key] : fallback),
    [prefs],
  );

  const setPref = useCallback(async (key, value) => {
    const user = userRef.current;
    if (!user) return;
    setPrefs((prev) => ({ ...prev, [key]: value })); // optimistic
    try {
      await DaylightAPI(`api/v1/piano/users/${user}/preferences`, { [key]: value }, 'PUT');
      logger().info('preferences.save', { user, key });
    } catch (e) {
      logger().error('preferences.save.fail', { user, key, error: e?.message });
    }
  }, []);

  return { prefs, loaded, getPref, setPref };
}

export default usePianoPreferences;
