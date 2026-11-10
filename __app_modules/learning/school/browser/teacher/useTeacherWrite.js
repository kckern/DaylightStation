/**
 * One server-authoritative teacher mutation flow.
 *
 * Ordinary actions require the capability cookie. Sensitive actions additionally
 * mint a one-use, resource-scoped step-up grant. A tap blocked on the profile
 * picker is replayed once after a teacher is selected; cancelled prompts never
 * become ghost writes later.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTeacherProfile } from "./TeacherProfileContext.jsx";
import { teacherLog } from "./teacherLog.js";

const responseMessage = (data, fallback) => (
  typeof data?.error === 'string' ? data.error : data?.error?.message ?? fallback
);

export function useTeacherWrite({ panel }) {
  const {
    currentTeacher, teachers, openPicker, pickerOpen, requestAuthorization, invalidateAuthorization,
  } = useTeacherProfile();
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const pendingClaimRef = useRef(null);

  const attempt = useCallback(async (key, call, onSuccess, stepUp, retrying = false) => {
    const actorId = currentTeacher?.id;
    if (!actorId) return false;
    const requirement = typeof stepUp === 'function' ? stepUp() : stepUp;
    const authorized = await requestAuthorization(requirement ?? {});
    if (!authorized.ok) {
      if (!authorized.cancelled && !authorized.busy) {
        // A refusal the teacher cannot retype their way out of arrives with the
        // server's own words; say those rather than the generic ask.
        setErrors((value) => ({ ...value, [key]: authorized.message ?? 'Teacher authorization is required.' }));
        if (authorized.refused) teacherLog.writeRefused('authorization-refused', { panel, key, status: authorized.status });
      }
      return false;
    }

    setBusy(key);
    setErrors((value) => ({ ...value, [key]: null }));
    const { ok, status, data } = await call({ actorId, pin: null, stepUpToken: authorized.grantToken });
    setBusy(null);
    if (ok) {
      teacherLog.write('saved', { panel, key, actorId });
      onSuccess?.(data);
      return true;
    }
    if (status === 403 && !retrying) {
      invalidateAuthorization();
      teacherLog.writeRefused('session-expired', { panel, key, status, actorId });
      return attempt(key, call, onSuccess, stepUp, true);
    }
    setErrors((value) => ({ ...value, [key]: responseMessage(data,
      status === 403 ? 'Teacher authorization was refused.' : 'That didn’t save — try again.') }));
    teacherLog.writeRefused('refused', { panel, key, status, actorId });
    return false;
  }, [currentTeacher, requestAuthorization, invalidateAuthorization, panel]);

  // `awaitClaim: true` makes a run blocked on the picker resolve only once
  // its replay has finished (or the stash is dropped, with false), so a
  // caller can treat the whole wait as one write in progress. Without it, a
  // blocked run answers false at once, as it always has.
  const run = useCallback(async (key, call, { onSuccess, stepUp = null, awaitClaim = false } = {}) => {
    if (!currentTeacher) {
      // Waiting on a picker that has nobody in it would wait for ever.
      if (awaitClaim && Array.isArray(teachers) && teachers.length === 0) {
        setErrors((value) => ({ ...value, [key]: 'No teacher is set up to sign in, so nothing was saved.' }));
        teacherLog.writeRefused('no-teachers', { panel, key });
        return false;
      }
      pendingClaimRef.current?.settle?.(false); // a newer tap replaces the stash
      let settle = null;
      const settled = awaitClaim ? new Promise((resolve) => { settle = resolve; }) : null;
      pendingClaimRef.current = { key, call, onSuccess, stepUp, settle };
      teacherLog.writeRefused('blocked-on-claim', { panel, key });
      openPicker();
      return settled ?? false;
    }
    return attempt(key, call, onSuccess, stepUp);
  }, [currentTeacher, teachers, openPicker, attempt, panel]);

  useEffect(() => {
    const pending = pendingClaimRef.current;
    if (!pending) return;
    if (currentTeacher) {
      pendingClaimRef.current = null;
      attempt(pending.key, pending.call, pending.onSuccess, pending.stepUp)
        .then((result) => pending.settle?.(result), (error) => {
          setBusy(null);
          teacherLog.writeRefused('replay-failed', { panel, key: pending.key, error: error?.message ?? String(error) });
          pending.settle?.(false);
        });
    } else if (!pickerOpen) {
      teacherLog.writeRefused('stash-dropped', { panel, key: pending.key });
      pendingClaimRef.current = null;
      pending.settle?.(false);
    }
  }, [currentTeacher, pickerOpen, attempt, panel]);

  // A run still waiting on the picker when its component goes away ends here.
  useEffect(() => () => {
    const pending = pendingClaimRef.current;
    pendingClaimRef.current = null;
    pending?.settle?.(false);
  }, []);

  return { run, busy, errors };
}

export default useTeacherWrite;
