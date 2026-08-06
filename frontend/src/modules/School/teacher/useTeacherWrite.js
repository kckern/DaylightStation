/**
 * useTeacherWrite — the one mutation flow (spec §1): no claimed teacher →
 * open the picker; the server 403s (bad/missing PIN, not a listed teacher) →
 * open the PIN prompt and surface a per-item message; success → the caller's
 * server-authoritative refresh. Never optimistic.
 */
import { useCallback, useState } from 'react';
import { useTeacherProfile } from './TeacherProfileContext.jsx';
import { teacherLog } from './teacherLog.js';

export function useTeacherWrite({ panel }) {
  const { currentTeacher, pin, openPicker, openPinPrompt } = useTeacherProfile();
  const [busy, setBusy] = useState(null);   // caller-chosen key of the in-flight row
  const [errors, setErrors] = useState({}); // key -> message

  const run = useCallback(async (key, call, { onSuccess } = {}) => {
    if (!currentTeacher) { openPicker(); return; }
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: null }));
    const { ok, status, data } = await call({ actorId: currentTeacher.id, pin });
    setBusy(null);
    if (ok) { onSuccess?.(data); return; }
    // The two handlers speak different shapes: school.mjs's wrap sends
    // {error: string}; the app-level object-shape handler sends
    // {error: {type, message}}. Normalize — an object must never reach JSX.
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    if (status === 403) {
      openPinPrompt();
      setErrors((e) => ({ ...e, [key]: message ?? 'The teacher PIN is missing or wrong — enter it and try again.' }));
    } else {
      setErrors((e) => ({ ...e, [key]: message ?? 'That didn’t save — try again.' }));
    }
    teacherLog.fetch('write-refused', { panel, key, status });
  }, [currentTeacher, pin, openPicker, openPinPrompt, panel]);

  return { run, busy, errors };
}

export default useTeacherWrite;
