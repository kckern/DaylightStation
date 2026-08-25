import { describe, expect, it } from 'vitest';
import {
  parseTeacherPath, teacherLearnerPath, teacherSectionPath, teacherSessionPath,
} from './teacherUrl.js';

describe('teacher workspace URL model', () => {
  it('lands roots on the dashboard and rejects malformed paths', () => {
    expect(parseTeacherPath('/school/teacher')).toMatchObject({ kind: 'section', section: 'dashboard' });
    expect(parseTeacherPath('/school/teacher/unknown')).toMatchObject({ kind: 'not-found' });
    expect(parseTeacherPath('/school/teacher/students/milo/history/not-a-session/ses_1')).toMatchObject({ kind: 'not-found' });
  });

  it('round-trips learner, course, and session routes', () => {
    expect(parseTeacherPath(teacherLearnerPath('a b', 'courses', 'world-history'))).toMatchObject({
      kind: 'learner', section: 'courses', learnerId: 'a b', courseId: 'world-history',
    });
    expect(parseTeacherPath(teacherSessionPath('a b', 'session/1'))).toMatchObject({
      kind: 'session', section: 'history', learnerId: 'a b', sessionId: 'session/1',
    });
  });

  it('rejects removed rollout and legacy aliases', () => {
    expect(parseTeacherPath('/school/teacher-next/queue')).toMatchObject({ kind: 'not-found' });
    expect(parseTeacherPath('/school/teacher/records/felix')).toMatchObject({ kind: 'not-found' });
    expect(parseTeacherPath('/school/teacher/planning/felix')).toMatchObject({ kind: 'not-found' });
  });
});
