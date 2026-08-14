/**
 * useTeacherWrite — the one mutation flow (spec §1): no claimed teacher →
 * open the picker; the server 403s (bad/missing PIN, not a listed teacher) →
 * open the PIN prompt and surface a per-item message; success → the caller's
 * server-authoritative refresh. Never optimistic.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTeacherProfile } from './TeacherProfileContext.jsx';
import { teacherLog } from './teacherLog.js';

export function useTeacherWrite({ panel }) {
  const { currentTeacher, pin, openPicker, openPinPrompt, pinPromptOpen, pickerOpen } = useTeacherProfile();
  const [busy, setBusy] = useState(null);   // caller-chosen key of the in-flight row
  const [errors, setErrors] = useState({}); // key -> message
  // A tap blocked on the claim or the PIN is STASHED and replayed once the
  // missing piece lands (advocacy A4): one tap becomes one mark, not the
  // first of three. Replay fires at most once per stash.
  const pendingRef = useRef(null);

  const attempt = useCallback(async (key, call, onSuccess, { actorId, pin: usePin }) => {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: null }));
    const { ok, status, data } = await call({ actorId, pin: usePin });
    setBusy(null);
    if (ok) {
      pendingRef.current = null;
      teacherLog.write('saved', { panel, key, actorId });
      onSuccess?.(data);
      return true;
    }
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    if (status === 403) {
      pendingRef.current = { key, call, onSuccess, pinAtStash: usePin, hadTeacher: true };
      openPinPrompt();
      setErrors((e) => ({ ...e, [key]: message ?? 'Enter the teacher PIN — this will save automatically.' }));
    } else {
      pendingRef.current = null;
      setErrors((e) => ({ ...e, [key]: message ?? 'That didn’t save — try again.' }));
    }
    // 403 is not a failure, it is the PIN gate doing its job and the write is
    // stashed for replay; anything else is a genuine refusal the teacher has to
    // act on. Distinguishing them is the difference between "the console is
    // broken" and "someone needs to type a PIN".
    teacherLog.writeRefused(status === 403 ? 'blocked-on-pin' : 'refused', { panel, key, status, actorId });
    return false;
  }, [openPinPrompt, panel]);

  const run = useCallback(async (key, call, { onSuccess } = {}) => {
    if (!currentTeacher) {
      pendingRef.current = { key, call, onSuccess, pinAtStash: pin, hadTeacher: false };
      teacherLog.writeRefused('blocked-on-claim', { panel, key });
      openPicker();
      return;
    }
    await attempt(key, call, onSuccess, { actorId: currentTeacher.id, pin });
  }, [currentTeacher, pin, openPicker, attempt]);

  // Replay the stashed action ONLY when the piece it was missing actually
  // arrives — a claim for a claim-blocked tap, a NEW pin for a pin-blocked
  // one. A DISMISSED prompt/picker clears the stash instead: an abandoned
  // tap must never fire as a ghost write on a later unrelated unlock.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (currentTeacher) {
      const unblocked = (!pending.hadTeacher) || (pin !== pending.pinAtStash);
      if (unblocked) {
        pendingRef.current = null;
        attempt(pending.key, pending.call, pending.onSuccess, { actorId: currentTeacher.id, pin });
        return;
      }
    }
    const dismissed = (pending.hadTeacher && !pinPromptOpen && pin === pending.pinAtStash)
      || (!pending.hadTeacher && !pickerOpen && !currentTeacher);
    if (dismissed) {
      // The teacher walked away from the picker or the PIN prompt, so a tap
      // they made never became a write. Nothing failed and nothing saved —
      // without this line that intent leaves no trace anywhere.
      teacherLog.writeRefused('stash-dropped', { panel, key: pending.key });
      pendingRef.current = null;
    }
  }, [currentTeacher, pin, pinPromptOpen, pickerOpen, attempt, panel]);

  return { run, busy, errors };
}

export default useTeacherWrite;
