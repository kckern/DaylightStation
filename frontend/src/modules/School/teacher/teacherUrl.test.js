import { describe, expect, it } from 'vitest';
import {
  parseTeacherPath, teacherDayPath, teacherLearnerPath, teacherSectionPath, teacherSessionPath,
} from './teacherUrl.js';

describe('teacher workspace URL model', () => {
  it('lands roots on the dashboard and rejects malformed paths', () => {
    expect(parseTeacherPath('/school/teacher')).toMatchObject({ kind: 'section', section: 'dashboard' });
    expect(parseTeacherPath('/school/teacher/unknown')).toMatchObject({ kind: 'not-found' });
    expect(parseTeacherPath('/school/teacher/students/learner-b/history/not-a-session/ses_1')).toMatchObject({ kind: 'not-found' });
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
    expect(parseTeacherPath('/school/teacher/records/learner-a')).toMatchObject({ kind: 'not-found' });
    expect(parseTeacherPath('/school/teacher/planning/learner-a')).toMatchObject({ kind: 'not-found' });
  });
});

describe('teacherSessionPath origin', () => {
  it('carries ?from= when the opener says so', async () => {
    const { teacherSessionPath } = await import('./teacherUrl.js');
    expect(teacherSessionPath('learner-b', 's1', '/school/teacher', { from: 'today' }))
      .toBe('/school/teacher/students/learner-b/history/sessions/s1?from=today');
    expect(teacherSessionPath('learner-b', 's1')).toBe('/school/teacher/students/learner-b/history/sessions/s1');
  });
});

describe('learner day route', () => {
  it('parses a dated day route', () => {
    expect(parseTeacherPath('/school/teacher/students/learner-a/day/2026-08-25')).toMatchObject({
      kind: 'learner', section: 'day', learnerId: 'learner-a', studyDay: '2026-08-25',
    });
  });
  it('parses an undated day route as today-by-default', () => {
    expect(parseTeacherPath('/school/teacher/students/learner-a/day')).toMatchObject({
      kind: 'learner', section: 'day', learnerId: 'learner-a', studyDay: null,
    });
  });
  it('rejects a malformed study day', () => {
    expect(parseTeacherPath('/school/teacher/students/learner-a/day/lastweek').kind).toBe('not-found');
  });
  it('builds a dated day path', () => {
    expect(teacherDayPath('learner-a', '2026-08-25')).toBe('/school/teacher/students/learner-a/day/2026-08-25');
  });
  it('builds an undated day path', () => {
    expect(teacherDayPath('learner-a')).toBe('/school/teacher/students/learner-a/day');
  });
  it('falls back to the dashboard without a learner', () => {
    expect(teacherDayPath(null, '2026-08-25')).toBe('/school/teacher/dashboard');
  });
});
