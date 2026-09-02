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
//
// THE PICK CARRIES A DATE, and the date is the whole of the 2026-09-02 fix. A
// remembered id is a fine default for filing a chess record — being wrong there
// costs a misfiled game. It is NOT sufficient to answer the school gate, which
// asks a question scoped to one study day. On 2026-09-02 this key still held a
// profile picked on 08-28; the office screen read that child's school day and
// told the adult standing in front of it to go and finish his schoolwork.
//
// So the stamp, and `identityStale` derived from it. This hook does not decide
// what staleness means for any given screen — it reports it, and the caller
// decides whether the question it is about to ask is one a five-day-old answer
// may stand in for.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '../../../../lib/api.mjs';
import { clientStudyDate } from '../../PianoKiosk/clientStudyDate.js';
import getLogger from '../../../../lib/logging/Logger.js';

export const STORAGE_KEY = 'daylight.piano.launcher.user';

const NOBODY = { id: null, studyDate: null };

const readStored = () => {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return NOBODY;
    // The key held a bare id string before the stamp existed. A value with no
    // date cannot be shown to belong to today, and the safe reading of "cannot
    // be shown to be today's" is stale — so it is kept as the default player
    // and reported as stale, rather than discarded.
    if (!raw.startsWith('{')) return { id: raw, studyDate: null };
    const parsed = JSON.parse(raw);
    return {
      id: typeof parsed?.id === 'string' ? parsed.id : null,
      studyDate: typeof parsed?.studyDate === 'string' ? parsed.studyDate : null,
    };
  } catch { return NOBODY; }
};

const writeStored = (entry) => {
  try {
    if (entry?.id) window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entry));
    else window.localStorage?.removeItem(STORAGE_KEY);
  } catch { /* private mode / storage disabled — the session still works */ }
};

/**
 * @returns {{
 *   users: Array, currentUser: string|null, identityStale: boolean,
 *   pickerOpen: boolean, openPicker: Function, closePicker: Function,
 *   pickUser: Function,
 * }}
 */
export function useLauncherUser() {
  const [users, setUsers] = useState([]);
  const [stored, setStored] = useState(readStored);
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
        setStored((prev) => (
          prev.id && roster.some((u) => u.id === prev.id) ? prev : NOBODY
        ));
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
    const next = id ? { id, studyDate: clientStudyDate() } : NOBODY;
    setStored(next);
    writeStored(next);
    setPickerOpen(false);
    getLogger().child({ component: 'piano-launcher' })
      .info('launcher.user-selected', { userId: next.id, studyDate: next.studyDate });
  }, []);

  // Nobody remembered is not a stale identity, it is an absent one — the
  // caller's existing "ask on first run" path already covers that, and
  // conflating the two would make the first-run prompt look like an expiry.
  const identityStale = useMemo(
    () => Boolean(stored.id) && stored.studyDate !== clientStudyDate(),
    [stored],
  );

  return {
    users, currentUser: stored.id, identityStale,
    pickerOpen, openPicker, closePicker, pickUser,
  };
}

export default useLauncherUser;
