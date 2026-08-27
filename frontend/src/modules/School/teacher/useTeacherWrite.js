/**
 * One server-authoritative teacher mutation flow.
 *
 * Ordinary actions require the capability cookie. Sensitive actions additionally
 * mint a one-use, resource-scoped step-up grant. A tap blocked on the profile
 * picker is replayed once after a teacher is selected; cancelled prompts never
 * become ghost writes later.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTeacherProfile } from './TeacherProfileContext.jsx';
import { teacherLog } from './teacherLog.js';

const responseMessage = (data, fallback) => (
  typeof data?.error === 'string' ? data.error : data?.error?.message ?? fallback
);

export function useTeacherWrite({ panel }) {
  const {
    currentTeacher, openPicker, pickerOpen, requestAuthorization, invalidateAuthorization,
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

  const run = useCallback(async (key, call, { onSuccess, stepUp = null } = {}) => {
    if (!currentTeacher) {
      pendingClaimRef.current = { key, call, onSuccess, stepUp };
      teacherLog.writeRefused('blocked-on-claim', { panel, key });
      openPicker();
      return false;
    }
    return attempt(key, call, onSuccess, stepUp);
  }, [currentTeacher, openPicker, attempt, panel]);

  useEffect(() => {
    const pending = pendingClaimRef.current;
    if (!pending) return;
    if (currentTeacher) {
      pendingClaimRef.current = null;
      attempt(pending.key, pending.call, pending.onSuccess, pending.stepUp);
    } else if (!pickerOpen) {
      teacherLog.writeRefused('stash-dropped', { panel, key: pending.key });
      pendingClaimRef.current = null;
    }
  }, [currentTeacher, pickerOpen, attempt, panel]);

  return { run, busy, errors };
}

export default useTeacherWrite;
