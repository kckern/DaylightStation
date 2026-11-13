/**
 * Teacher identity container.
 *
 * The selected teacher is a localStorage-backed claim — remembered across
 * reloads and tabs so a grown-up picks once, forgotten only by Sign out or
 * when the id leaves the teacher roster. Writes carry the picked teacher's id;
 * the server checks that id against the listed teachers.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { schoolApi } from "../schoolApi.js";
import { teacherLog } from "./teacherLog.js";

const STORAGE_KEY = 'school-teacher-claim';
// Storage can be absent or throw (private window, blocked site data): the
// claim is a convenience, so a failed read is "nobody picked" and a failed
// write is silently not remembered.
const claimStore = {
  get() { try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; } },
  set(id) { try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* not remembered */ } },
  clear() { try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clear */ } },
};
const TeacherProfileContext = createContext(null);

export function TeacherProfileProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [configured, setConfigured] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    schoolApi.teachers().then((teacherResponse) => {
      if (!alive) return;
      const list = teacherResponse.ok && Array.isArray(teacherResponse.data?.teachers)
        ? teacherResponse.data.teachers : [];
      setConfigured(Boolean(teacherResponse.ok && teacherResponse.data?.configured));
      setTeachers(list);
      const stored = claimStore.get();
      const storedId = list.some((teacher) => teacher.id === stored) ? stored : null;
      if (storedId) {
        setCurrentId(storedId);
        teacherLog.claim('restored', { teacherId: storedId });
      } else {
        claimStore.clear();
      }
      setStatus('ready');
    }).catch(() => {
      if (!alive) return;
      setConfigured(false);
      setTeachers([]);
      setStatus('ready');
    });
    return () => { alive = false; };
  }, []);

  const claim = useCallback((id) => {
    setCurrentId(id);
    claimStore.set(id);
    setPickerOpen(false);
    teacherLog.claim('claimed', { teacherId: id });
  }, []);

  const release = useCallback(() => {
    setCurrentId(null);
    claimStore.clear();
    teacherLog.claim('released', {});
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const value = useMemo(() => ({
    status,
    configured,
    teachers,
    currentTeacher: teachers.find((teacher) => teacher.id === currentId) ?? null,
    claim,
    release,
    pickerOpen,
    openPicker,
    closePicker,
  }), [status, configured, teachers, currentId, claim, release, pickerOpen, openPicker, closePicker]);

  return <TeacherProfileContext.Provider value={value}>{children}</TeacherProfileContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- useTeacherProfile is co-located with its Context/Provider (standard pattern); 23 consumers, splitting out of scope for a lint pass
export function useTeacherProfile() {
  const ctx = useContext(TeacherProfileContext);
  if (!ctx) throw new Error('useTeacherProfile requires TeacherProfileProvider');
  return ctx;
}

/**
 * The same context, but ABSENT is an answer rather than a crash.
 *
 * For components that are mounted inside the console in the real app but must
 * not take a whole screen down if they are ever rendered outside it. The roster
 * strip is the case: it now carries a print control, and a throwing hook there
 * would blank the dashboard — every child's row gone because one button could
 * not find its provider. A missing provider means "you cannot authorize from
 * here", which is a button that hides, not a page that dies.
 */
export function useTeacherProfileOptional() {
  return useContext(TeacherProfileContext) ?? null;
}
