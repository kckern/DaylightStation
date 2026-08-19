// useLauncherUser.js — who is playing, on a screen that has no idea.
//
// The piano kiosk knows: it has a Who's-Playing prompt and a roster context. The
// office screen has neither, so every game there ran as nobody — which is fine
// for Tetris and wrong for anything that keeps a record (chess files a game
// record per player).
//
// Remembered rather than asked. Being made to answer "who are you" before every
// single game is the kind of friction that stops people using a thing at all, so
// the last player is the default and changing it is one key press.

import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '../../../../lib/api.mjs';
import getLogger from '../../../../lib/logging/Logger.js';

const STORAGE_KEY = 'daylight.piano.launcher.user';

const readStored = () => {
  try { return window.localStorage?.getItem(STORAGE_KEY) || null; } catch { return null; }
};
const writeStored = (id) => {
  try {
    if (id) window.localStorage?.setItem(STORAGE_KEY, id);
    else window.localStorage?.removeItem(STORAGE_KEY);
  } catch { /* private mode / storage disabled — the session still works */ }
};

/**
 * @returns {{
 *   users: Array, currentUser: string|null, pickerOpen: boolean,
 *   openPicker: Function, closePicker: Function, pickUser: Function,
 * }}
 */
export function useLauncherUser() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(() => readStored());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/piano/users')
      .then((res) => {
        if (cancelled) return;
        const roster = Array.isArray(res) ? res : res?.users ?? [];
        setUsers(roster);
        // A remembered id that is no longer on the roster is worse than none —
        // it files results under someone who does not exist.
        setCurrentUser((id) => (id && roster.some((u) => u.id === id) ? id : null));
      })
      .catch((err) => {
        getLogger().child({ component: 'piano-launcher' })
          .warn('launcher.roster-failed', { error: err.message });
      });
    return () => { cancelled = true; };
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const pickUser = useCallback((id) => {
    const next = id || null;
    setCurrentUser(next);
    writeStored(next);
    setPickerOpen(false);
    getLogger().child({ component: 'piano-launcher' }).info('launcher.user-selected', { userId: next });
  }, []);

  return { users, currentUser, pickerOpen, openPicker, closePicker, pickUser };
}

export default useLauncherUser;
