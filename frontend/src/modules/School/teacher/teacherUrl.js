/** Route model for the teacher operations workspace.
 *
 * The console intentionally owns its navigation instead of nesting another
 * BrowserRouter, which makes every learner/session view bookmarkable.
 *
 * It once had to serve two bases at once — the final route and a temporary
 * rollout alias. It does not any more: `/school/teacher-next` is a redirect and
 * the console never renders there. `teacherBaseFor` is the vestige of that
 * period; it ignores its argument and returns `TEACHER_BASE` unconditionally,
 * kept only so its many call sites do not all have to change at once.
 */
export const TEACHER_BASE = '/school/teacher';

export const SECTIONS = ['dashboard', 'queue', 'curriculum', 'operations'];
export const LEARNER_SECTIONS = ['day', 'courses', 'history', 'reports', 'operations'];

const decode = (value) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

const STUDY_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function teacherBaseFor(_pathname = '') {
  return TEACHER_BASE;
}

export function parseTeacherPath(pathname) {
  const base = teacherBaseFor(pathname);
  const segments = String(pathname ?? '').slice(base.length).split('/').filter(Boolean).map(decode);
  const notFound = () => ({ kind: 'not-found', section: null, learnerId: null, courseId: null, sessionId: null, base });
  if (!segments.length) return { kind: 'section', section: 'dashboard', learnerId: null, courseId: null, sessionId: null, base };

  if (segments[0] === 'students' && segments[1]) {
    const learnerId = segments[1];
    if (segments.length === 2) return { kind: 'learner', section: 'day', learnerId, courseId: null, sessionId: null, base };
    if (segments[2] === 'day') {
      if (segments.length === 3) {
        return { kind: 'learner', section: 'day', learnerId, courseId: null, sessionId: null, studyDay: null, base };
      }
      if (segments.length === 4 && STUDY_DAY.test(segments[3])) {
        return { kind: 'learner', section: 'day', learnerId, courseId: null, sessionId: null, studyDay: segments[3], base };
      }
      return notFound();
    }
    if (segments[2] === 'history' && segments[3] === 'sessions' && segments.length === 5) {
      return { kind: 'session', section: 'history', learnerId, courseId: null, sessionId: segments[4], base };
    }
    if (segments[2] === 'courses' && segments.length === 4) {
      return { kind: 'learner', section: 'courses', learnerId, courseId: segments[3], sessionId: null, base };
    }
    // `overview` is retired — LearnerOverview was a pure alias of the Day
    // record (trim wave 5.6). It is no longer a real section, but the
    // segment must still parse instead of 404ing, so the shell has a
    // `section: 'overview'` to catch and redirect to the bare learner path.
    if (segments[2] === 'overview' && segments.length === 3) {
      return { kind: 'learner', section: 'overview', learnerId, courseId: null, sessionId: null, base };
    }
    if (LEARNER_SECTIONS.includes(segments[2]) && segments.length === 3) {
      return { kind: 'learner', section: segments[2], learnerId, courseId: null, sessionId: null, base };
    }
    return notFound();
  }

  if (segments[0] === 'sessions' && segments[1] && segments.length === 2) {
    return { kind: 'session', section: 'history', learnerId: null, courseId: null, sessionId: segments[1], base };
  }

  if (['dashboard', 'queue', 'operations'].includes(segments[0]) && segments.length === 1) {
    return { kind: 'section', section: segments[0], learnerId: null, courseId: null, lessonId: null, sessionId: null, base };
  }
  if (segments[0] === 'curriculum' && segments.length <= 2) {
    return { kind: 'section', section: 'curriculum', learnerId: null, courseId: segments[1] ?? null, lessonId: null, sessionId: null, base };
  }
  if (segments[0] === 'curriculum' && segments[2] === 'lessons' && segments.length === 4) {
    return { kind: 'section', section: 'curriculum', learnerId: null, courseId: segments[1], lessonId: segments[3], sessionId: null, base };
  }
  return notFound();
}

export function teacherSectionPath(section = 'dashboard', base = TEACHER_BASE) {
  const safe = SECTIONS.includes(section) ? section : 'dashboard';
  return `${base}/${safe}`;
}

export function teacherLearnerPath(learnerId, section = 'day', detailId = null, base = TEACHER_BASE) {
  if (!learnerId) return teacherSectionPath('dashboard', base);
  const safe = LEARNER_SECTIONS.includes(section) ? section : 'day';
  const suffix = detailId && safe === 'courses' ? `/${encodeURIComponent(detailId)}` : '';
  return `${base}/students/${encodeURIComponent(learnerId)}/${safe}${suffix}`;
}

/** The day record for one learner. An omitted day means "today" to the view. */
export function teacherDayPath(learnerId, studyDay = null, base = TEACHER_BASE) {
  if (!learnerId) return teacherSectionPath('dashboard', base);
  const suffix = studyDay ? `/${encodeURIComponent(studyDay)}` : '';
  return `${base}/students/${encodeURIComponent(learnerId)}/day${suffix}`;
}

export function teacherSessionPath(learnerId, sessionId, base = TEACHER_BASE, { from = null } = {}) {
  const path = learnerId
    ? `${teacherLearnerPath(learnerId, 'history', null, base)}/sessions/${encodeURIComponent(sessionId)}`
    : `${base}/sessions/${encodeURIComponent(sessionId)}`;
  // `from` records the view that opened the session, so Back can return
  // there instead of always landing on History.
  return from ? `${path}?from=${encodeURIComponent(from)}` : path;
}
