/**
 * Teacher identity container (teacher-console spec §4.1). A soft claim over
 * the server-resolved teachers read — the client never filters or augments
 * the list; whatever `GET /teachers` returns IS the picker. Session-persisted
 * (a parent's own browser tab, not a shared kiosk — hence sessionStorage and
 * no idle lapse). In the skeleton the claim is chrome plus the future
 * mutation stamp (`assignedBy`/`closedBy`/`approver`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { teacherLog } from './teacherLog.js';

const STORAGE_KEY = 'school-teacher-claim';

const TeacherProfileContext = createContext(null);

export function TeacherProfileProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [configured, setConfigured] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    schoolApi.teachers().then(({ ok, data }) => {
      if (!alive) return;
      const list = ok && Array.isArray(data?.teachers) ? data.teachers : [];
      setConfigured(Boolean(ok && data?.configured));
      setTeachers(list);
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored && list.some((t) => t.id === stored)) {
        setCurrentId(stored);
        teacherLog.claim('restored', { teacherId: stored });
      } else if (stored) {
        // No longer a teacher (config change, roster change): fail to unclaimed.
        sessionStorage.removeItem(STORAGE_KEY);
      }
      setStatus('ready');
    });
    return () => { alive = false; };
  }, []);

  const claim = useCallback((id) => {
    setCurrentId(id);
    sessionStorage.setItem(STORAGE_KEY, id);
    setPickerOpen(false);
    teacherLog.claim('claimed', { teacherId: id });
  }, []);

  const release = useCallback(() => {
    setCurrentId(null);
    sessionStorage.removeItem(STORAGE_KEY);
    teacherLog.claim('released', {});
  }, []);

  const value = useMemo(() => ({
    status,
    configured,
    teachers,
    currentTeacher: teachers.find((t) => t.id === currentId) ?? null,
    claim,
    release,
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
  }), [status, configured, teachers, currentId, claim, release, pickerOpen]);

  return (
    <TeacherProfileContext.Provider value={value}>
      {children}
    </TeacherProfileContext.Provider>
  );
}

export function useTeacherProfile() {
  const ctx = useContext(TeacherProfileContext);
  if (!ctx) throw new Error('useTeacherProfile requires TeacherProfileProvider');
  return ctx;
}
