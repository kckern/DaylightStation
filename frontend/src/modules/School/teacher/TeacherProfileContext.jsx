/**
 * Teacher identity + authorization container.
 *
 * The selected teacher is a soft, sessionStorage-backed UI claim. Authority is
 * a short-lived, server-owned HttpOnly capability cookie. PINs only exist in
 * the PinPrompt input long enough to unlock or mint a one-use step-up grant;
 * they are never stored in this context or attached to ordinary writes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';
import { teacherLog } from './teacherLog.js';

const STORAGE_KEY = 'school-teacher-claim';
const TeacherProfileContext = createContext(null);

const inactiveAuthorization = () => ({ active: false, userId: null, idleExpiresAt: null, absoluteExpiresAt: null });
const errorMessage = (response, fallback) => (
  typeof response?.data?.error === 'string' ? response.data.error
    : response?.data?.error?.message ?? fallback
);

export function TeacherProfileProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [configured, setConfigured] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [authorization, setAuthorization] = useState(inactiveAuthorization);
  const [pinPrompt, setPinPrompt] = useState({ open: false, busy: false, error: null, action: null, resource: null });
  const pendingAuthorizationRef = useRef(null);
  const currentIdRef = useRef(null);
  const authorizationRef = useRef(authorization);

  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  useEffect(() => { authorizationRef.current = authorization; }, [authorization]);

  useEffect(() => {
    let alive = true;
    Promise.all([schoolApi.teachers(), teacherWorkspaceApi.authStatus()]).then(([teacherResponse, authResponse]) => {
      if (!alive) return;
      const list = teacherResponse.ok && Array.isArray(teacherResponse.data?.teachers)
        ? teacherResponse.data.teachers : [];
      setConfigured(Boolean(teacherResponse.ok && teacherResponse.data?.configured));
      setTeachers(list);

      const serverAuth = authResponse.ok && authResponse.data?.active ? authResponse.data : inactiveAuthorization();
      const authenticatedId = list.some((teacher) => teacher.id === serverAuth.userId) ? serverAuth.userId : null;
      const stored = sessionStorage.getItem(STORAGE_KEY);
      const storedId = list.some((teacher) => teacher.id === stored) ? stored : null;
      const resolvedId = authenticatedId ?? storedId;
      if (resolvedId) {
        // Keep the imperative authorization path in sync before React commits.
        // A fast click during initial paint must not see a rendered teacher but
        // a still-null ref and incorrectly refuse the action.
        currentIdRef.current = resolvedId;
        setCurrentId(resolvedId);
        sessionStorage.setItem(STORAGE_KEY, resolvedId);
        teacherLog.claim(authenticatedId ? 'session-restored' : 'restored', { teacherId: resolvedId });
      } else {
        currentIdRef.current = null;
        sessionStorage.removeItem(STORAGE_KEY);
      }
      const resolvedAuthorization = authenticatedId ? serverAuth : inactiveAuthorization();
      authorizationRef.current = resolvedAuthorization;
      setAuthorization(resolvedAuthorization);
      setStatus('ready');
    }).catch(() => {
      if (!alive) return;
      setConfigured(false);
      setTeachers([]);
      const inactive = inactiveAuthorization();
      authorizationRef.current = inactive;
      setAuthorization(inactive);
      setStatus('ready');
    });
    return () => { alive = false; };
  }, []);

  const settlePending = useCallback((result) => {
    const pending = pendingAuthorizationRef.current;
    pendingAuthorizationRef.current = null;
    pending?.resolve(result);
  }, []);

  const invalidateAuthorization = useCallback(() => {
    const inactive = inactiveAuthorization();
    authorizationRef.current = inactive;
    setAuthorization(inactive);
  }, []);

  const claim = useCallback((id) => {
    const priorAuthorization = authorizationRef.current;
    if (priorAuthorization.active && priorAuthorization.userId !== id) {
      teacherWorkspaceApi.lock();
      setAuthorization(inactiveAuthorization());
    }
    setCurrentId(id);
    currentIdRef.current = id;
    sessionStorage.setItem(STORAGE_KEY, id);
    setPickerOpen(false);
    teacherLog.claim('claimed', { teacherId: id });
  }, []);

  const release = useCallback(() => {
    teacherWorkspaceApi.lock();
    settlePending({ ok: false, cancelled: true });
    setCurrentId(null);
    currentIdRef.current = null;
    setAuthorization(inactiveAuthorization());
    sessionStorage.removeItem(STORAGE_KEY);
    setPinPrompt({ open: false, busy: false, error: null, action: null, resource: null });
    teacherLog.claim('released', {});
  }, [settlePending]);

  const requestAuthorization = useCallback(({ action = null, resource = null } = {}) => {
    const teacherId = currentIdRef.current;
    if (!teacherId) return Promise.resolve({ ok: false, needsTeacher: true });
    const currentAuthorization = authorizationRef.current;
    if (!action && currentAuthorization.active && currentAuthorization.userId === teacherId) {
      return Promise.resolve({ ok: true, grantToken: null });
    }
    // Only one user gesture may own the PIN dialog. Superseding it would make
    // the abandoned caller wait forever, so fail the newer request explicitly.
    if (pendingAuthorizationRef.current) {
      return Promise.resolve({ ok: false, busy: true });
    }
    return new Promise((resolve) => {
      pendingAuthorizationRef.current = { resolve, action, resource, teacherId };
      setPinPrompt({ open: true, busy: false, error: null, action, resource });
    });
  }, []);

  const submitPin = useCallback(async (pin) => {
    const pending = pendingAuthorizationRef.current;
    if (!pending || !pinPrompt.open || pinPrompt.busy) return;
    const normalizedPin = typeof pin === 'string' ? pin.trim() : '';
    if (!normalizedPin) {
      setPinPrompt((value) => ({ ...value, error: 'Enter the teacher PIN.' }));
      return;
    }
    setPinPrompt((value) => ({ ...value, busy: true, error: null }));
    let active = authorizationRef.current;
    // Whether the server has accepted THIS PIN during THIS submission. It is
    // the only thing that separates "type it again" from "typing it again
    // cannot help", because both refusals come back as a bare 403.
    let pinProven = false;
    if (!active.active || active.userId !== pending.teacherId) {
      const unlocked = await teacherWorkspaceApi.unlock(pending.teacherId, normalizedPin);
      if (!unlocked.ok) {
        setAuthorization(inactiveAuthorization());
        setPinPrompt((value) => ({ ...value, busy: false,
          error: errorMessage(unlocked, unlocked.status === 0 ? 'Couldn’t reach the teacher service.' : 'The PIN was not accepted.') }));
        teacherLog.claim('unlock-refused', { teacherId: pending.teacherId, status: unlocked.status });
        return;
      }
      active = { active: true, ...unlocked.data };
      authorizationRef.current = active;
      setAuthorization(active);
      pinProven = true;
      teacherLog.claim('unlocked', { teacherId: pending.teacherId });
    }

    let grantToken = null;
    if (pending.action) {
      let steppedUp = await teacherWorkspaceApi.stepUp({
        pin: normalizedPin, action: pending.action, resource: pending.resource,
      });
      // The local view can be stale when the server's idle window elapsed.
      // Reuse this same fresh PIN once to replace the expired cookie and mint
      // the requested grant; never make the teacher type it twice.
      if (!steppedUp.ok && steppedUp.status === 403) {
        const unlocked = await teacherWorkspaceApi.unlock(pending.teacherId, normalizedPin);
        if (unlocked.ok) {
          active = { active: true, ...unlocked.data };
          authorizationRef.current = active;
          setAuthorization(active);
          pinProven = true;
          steppedUp = await teacherWorkspaceApi.stepUp({
            pin: normalizedPin, action: pending.action, resource: pending.resource,
          });
        }
      }
      if (!steppedUp.ok) {
        if (steppedUp.status === 403) {
          const checked = await teacherWorkspaceApi.authStatus();
          const nextAuthorization = checked.ok && checked.data?.active
            && checked.data.userId === pending.teacherId ? checked.data : inactiveAuthorization();
          authorizationRef.current = nextAuthorization;
          setAuthorization(nextAuthorization);
        }
        const message = errorMessage(steppedUp,
          steppedUp.status === 0 ? 'Couldn’t reach the teacher service.' : 'Fresh confirmation was not accepted.');
        // A wrong PIN, or a service we couldn't reach, is worth another go —
        // hold the dialog open. A 403 the server returned AFTER accepting this
        // very PIN is about the action, not the person: no PIN will ever
        // satisfy it, so settle the caller's promise with the refusal and get
        // out of the way. Leaving it unsettled is what wedged the reprint and
        // curriculum-exception buttons: a dialog forever, a write that never
        // resolved, and no error anywhere.
        const retryable = steppedUp.status === 0 || (steppedUp.status === 403 && !pinProven);
        teacherLog.claim('step-up-refused', {
          teacherId: pending.teacherId, action: pending.action, status: steppedUp.status, retryable,
        });
        if (retryable) {
          setPinPrompt((value) => ({ ...value, busy: false, error: message }));
          return;
        }
        setPinPrompt({ open: false, busy: false, error: null, action: null, resource: null });
        settlePending({ ok: false, refused: true, status: steppedUp.status, message });
        return;
      }
      grantToken = steppedUp.data?.grantToken ?? null;
    }

    setPinPrompt({ open: false, busy: false, error: null, action: null, resource: null });
    settlePending({ ok: true, grantToken });
  }, [pinPrompt.open, pinPrompt.busy, settlePending]);

  const closePinPrompt = useCallback(() => {
    setPinPrompt({ open: false, busy: false, error: null, action: null, resource: null });
    settlePending({ ok: false, cancelled: true });
  }, [settlePending]);

  const value = useMemo(() => ({
    status,
    configured,
    teachers,
    currentTeacher: teachers.find((teacher) => teacher.id === currentId) ?? null,
    claim,
    release,
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    authorization,
    requestAuthorization,
    invalidateAuthorization,
    // Compatibility: mutation builders still include `pin`, but it is always
    // null. The router replaces it with the HttpOnly cookie capability.
    pin: null,
    pinPromptOpen: pinPrompt.open,
    pinPromptBusy: pinPrompt.busy,
    pinPromptError: pinPrompt.error,
    pinPromptAction: pinPrompt.action,
    submitPin,
    setPin: submitPin,
    openPinPrompt: () => requestAuthorization(),
    closePinPrompt,
  }), [status, configured, teachers, currentId, claim, release, pickerOpen, authorization,
    requestAuthorization, invalidateAuthorization, pinPrompt, submitPin, closePinPrompt]);

  return <TeacherProfileContext.Provider value={value}>{children}</TeacherProfileContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- useTeacherProfile is co-located with its Context/Provider (standard pattern); 23 consumers, splitting out of scope for a lint pass
export function useTeacherProfile() {
  const ctx = useContext(TeacherProfileContext);
  if (!ctx) throw new Error('useTeacherProfile requires TeacherProfileProvider');
  return ctx;
}
