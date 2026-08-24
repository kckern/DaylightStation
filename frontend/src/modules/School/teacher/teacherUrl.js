/** Route model for the teacher operations workspace.
 *
 * The console intentionally owns its navigation instead of nesting another
 * BrowserRouter. That keeps it usable at both the final route and the
 * temporary rollout alias, and makes every learner/session view bookmarkable.
 */
export const TEACHER_BASE = '/school/teacher';
export const TEACHER_NEXT_BASE = '/school/teacher-next';

export const SECTIONS = ['dashboard', 'queue', 'curriculum', 'operations'];
export const LEARNER_SECTIONS = ['overview', 'courses', 'history', 'reports', 'operations'];

const decode = (value) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

export function teacherBaseFor(pathname = '') {
  return String(pathname).startsWith(TEACHER_NEXT_BASE) ? TEACHER_NEXT_BASE : TEACHER_BASE;
}

export function parseTeacherPath(pathname) {
  const base = teacherBaseFor(pathname);
  const segments = String(pathname ?? '').slice(base.length).split('/').filter(Boolean).map(decode);
  if (!segments.length) return { kind: 'section', section: 'dashboard', learnerId: null, courseId: null, sessionId: null, base };

  // Preserve useful old bookmarks while the previous four-tab console ages out.
  const legacy = { today: 'dashboard', planning: 'courses', records: 'reports', repair: 'operations' };
  if (legacy[segments[0]]) {
    const learnerId = segments[1] ?? null;
    return learnerId
      ? { kind: 'learner', section: legacy[segments[0]], learnerId, courseId: null, sessionId: null, base }
      : { kind: 'section', section: segments[0] === 'today' ? 'dashboard' : (segments[0] === 'repair' ? 'operations' : 'dashboard'), learnerId: null, courseId: null, sessionId: null, base };
  }

  if (segments[0] === 'students' && segments[1]) {
    const learnerId = segments[1];
    const section = LEARNER_SECTIONS.includes(segments[2]) ? segments[2] : 'overview';
    const sessionIndex = segments.indexOf('sessions');
    return {
      kind: sessionIndex >= 0 && segments[sessionIndex + 1] ? 'session' : 'learner',
      section,
      learnerId,
      courseId: section === 'courses' ? (segments[3] ?? null) : null,
      sessionId: sessionIndex >= 0 ? (segments[sessionIndex + 1] ?? null) : null,
      base,
    };
  }

  if (segments[0] === 'sessions' && segments[1]) {
    return { kind: 'session', section: 'history', learnerId: null, courseId: null, sessionId: segments[1], base };
  }

  const section = SECTIONS.includes(segments[0]) ? segments[0] : 'dashboard';
  return { kind: 'section', section, learnerId: null,
    courseId: section === 'curriculum' ? (segments[1] ?? null) : null,
    lessonId: section === 'curriculum' && segments[2] === 'lessons' ? (segments[3] ?? null) : null,
    sessionId: null, base };
}

export function teacherSectionPath(section = 'dashboard', base = TEACHER_BASE) {
  const safe = SECTIONS.includes(section) ? section : 'dashboard';
  return `${base}/${safe}`;
}

export function teacherLearnerPath(learnerId, section = 'overview', detailId = null, base = TEACHER_BASE) {
  if (!learnerId) return teacherSectionPath('dashboard', base);
  const safe = LEARNER_SECTIONS.includes(section) ? section : 'overview';
  const suffix = detailId && safe === 'courses' ? `/${encodeURIComponent(detailId)}` : '';
  return `${base}/students/${encodeURIComponent(learnerId)}/${safe}${suffix}`;
}

export function teacherSessionPath(learnerId, sessionId, base = TEACHER_BASE) {
  return learnerId
    ? `${teacherLearnerPath(learnerId, 'history', null, base)}/sessions/${encodeURIComponent(sessionId)}`
    : `${base}/sessions/${encodeURIComponent(sessionId)}`;
}

// Compatibility exports used by older callers/tests.
export const TABS = ['today', 'planning', 'records', 'repair'];
export function teacherPathFor(tab, learnerId = null) {
  const section = { today: 'dashboard', planning: 'courses', records: 'reports', repair: 'operations' }[tab] ?? 'dashboard';
  return learnerId ? teacherLearnerPath(learnerId, section) : teacherSectionPath(section === 'courses' || section === 'reports' ? 'dashboard' : section);
}
