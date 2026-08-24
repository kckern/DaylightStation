import { describe, expect, it } from 'vitest';
import {
  parseTeacherPath, teacherLearnerPath, teacherSectionPath, teacherSessionPath,
} from './teacherUrl.js';

describe('teacher workspace URL model', () => {
  it('lands roots and stale paths on the dashboard', () => {
    expect(parseTeacherPath('/school/teacher')).toMatchObject({ kind: 'section', section: 'dashboard' });
    expect(parseTeacherPath('/school/teacher/unknown')).toMatchObject({ kind: 'section', section: 'dashboard' });
  });

  it('round-trips learner, course, and session routes', () => {
    expect(parseTeacherPath(teacherLearnerPath('a b', 'courses', 'world-history'))).toMatchObject({
      kind: 'learner', section: 'courses', learnerId: 'a b', courseId: 'world-history',
    });
    expect(parseTeacherPath(teacherSessionPath('a b', 'session/1'))).toMatchObject({
      kind: 'session', section: 'history', learnerId: 'a b', sessionId: 'session/1',
    });
  });

  it('supports the temporary rollout base', () => {
    expect(parseTeacherPath('/school/teacher-next/queue')).toMatchObject({ base: '/school/teacher-next', section: 'queue' });
    expect(teacherSectionPath('operations', '/school/teacher-next')).toBe('/school/teacher-next/operations');
  });

  it('interprets useful legacy bookmarks', () => {
    expect(parseTeacherPath('/school/teacher/records/felix')).toMatchObject({ kind: 'learner', learnerId: 'felix', section: 'reports' });
    expect(parseTeacherPath('/school/teacher/planning/felix')).toMatchObject({ kind: 'learner', learnerId: 'felix', section: 'courses' });
  });
});
