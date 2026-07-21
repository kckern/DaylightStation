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
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && users.some((u) => u.id === stored)) {
        setCurrentId(stored);
      } else if (stored) {
        localStorage.removeItem(STORAGE_KEY); // departed roster member: fail to unclaimed
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

  const unclaim = useCallback((reason = 'lapse') => {
    setCurrentId((prev) => {
      if (prev) schoolLog.profile('lapsed', { userId: prev, reason });
      return null;
    });
    setIsGuest(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

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
