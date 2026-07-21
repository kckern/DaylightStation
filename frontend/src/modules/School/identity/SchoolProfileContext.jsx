/**
 * School identity container (spec §6). Soft pick + idle lapse: identity is
 * claimable by a tap, persisted per-device under the flat key 'school:user',
 * and cleared when a >=10-minute idle gap is detected (on the next
 * interaction — the piano-proven useIdleGap model). Guest is a session-only
 * state and is never persisted. Runners react to identity changes themselves
 * (they abandon their session when currentUser changes — spec §6).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useIdleGap } from '../../../lib/identity/useIdleGap.js';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

const STORAGE_KEY = 'school:user';
const LAPSE_MINUTES = 10;

const SchoolProfileContext = createContext(null);

export function SchoolProfileProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [roster, setRoster] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    schoolApi.roster().then(({ ok, data }) => {
      if (!alive) return;
      const users = ok && Array.isArray(data) ? data : [];
      setRoster(users);
      // Departed-member cleanup only makes sense once we actually know who's
      // on the roster. A failed fetch (network hiccup, container redeploy)
      // must not be mistaken for "this child left the household" -- leave
      // any persisted claim untouched so it survives to the next load.
      if (ok) {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && users.some((u) => u.id === stored)) {
          setCurrentId(stored);
        } else if (stored) {
          localStorage.removeItem(STORAGE_KEY); // departed roster member: fail to unclaimed
        }
      }
      setStatus('ready');
    });
    return () => { alive = false; };
  }, []);

  const claim = useCallback((id) => {
    setCurrentId(id);
    setIsGuest(false);
    setPickerOpen(false);
    localStorage.setItem(STORAGE_KEY, id);
    schoolLog.profile('claimed', { userId: id });
  }, []);

  const continueAsGuest = useCallback(() => {
    setCurrentId(null);
    setIsGuest(true);
    setPickerOpen(false);
    localStorage.removeItem(STORAGE_KEY);
    schoolLog.profile('claimed', { userId: null, guest: true });
  }, []);

  // No caller ever supplies a custom reason (the only trigger is the idle
  // gap below), so the log site is hardcoded rather than carrying a
  // parameter nothing reaches. A guest session lapsing is logged too,
  // distinguished by a null userId + guest flag, so it's not silently
  // indistinguishable from "nothing happened".
  const unclaim = useCallback(() => {
    if (currentId) {
      schoolLog.profile('lapsed', { userId: currentId, reason: 'lapse' });
    } else if (isGuest) {
      schoolLog.profile('lapsed', { userId: null, guest: true, reason: 'lapse' });
    }
    setCurrentId(null);
    setIsGuest(false);
    localStorage.removeItem(STORAGE_KEY);
  }, [currentId, isGuest]);

  // 10-minute idle lapse. Any pointerdown/keydown counts as interaction
  // (answering an item is a tap), so a slow thinker never lapses mid-quiz.
  useIdleGap(undefined, 0, LAPSE_MINUTES, unclaim);

  const currentUser = useMemo(() => roster.find((u) => u.id === currentId) || null, [roster, currentId]);
  const value = useMemo(() => ({
    status, roster, currentUser, isGuest, pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    claim, continueAsGuest, unclaim,
  }), [status, roster, currentUser, isGuest, pickerOpen, claim, continueAsGuest, unclaim]);

  return <SchoolProfileContext.Provider value={value}>{children}</SchoolProfileContext.Provider>;
}

export function useSchoolProfile() {
  const ctx = useContext(SchoolProfileContext);
  if (!ctx) throw new Error('useSchoolProfile requires SchoolProfileProvider');
  return ctx;
}
